import {
  type Converter,
  costLedger,
  type Database,
  events,
  type Logger,
  readSettings,
  type Settings,
} from '@goodies-beacon/core';
import { and, gte, lt, sql } from 'drizzle-orm';

/**
 * The monthly budget cap (§9): when the month's AI spend reaches it, reviews stop rather than
 * carrying on until a card is declined.
 *
 * "Pauses" is deliberate rather than "fails": a deferred review is a job that runs next month, or
 * as soon as the cap is raised, with nothing lost. A failed one would exhaust its retries against
 * a condition that no retry can fix and dead-letter a candidate the owner might have wanted.
 */

export interface BudgetState {
  /** True when there is room to spend, or no cap is set. */
  ok: boolean;
  /** The month's spend in GBP, or null when nothing has been spent or no rate is available. */
  spentGbp: number | null;
  capGbp: number | null;
  /** When the cap next resets: the first instant of next month, UTC. */
  resetsAt: Date;
}

/** `YYYY-MM` in UTC — the dedupe key that makes one exceeded event per month, not per job. */
export function budgetPeriod(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface BudgetDeps {
  db: Database;
  logger: Logger;
  /** P1-06's converter: the ledger is in dollars and the cap is typed in pounds. */
  converter: Converter;
  settings?: Settings;
  now?: () => Date;
}

/**
 * The month's spend against the cap.
 *
 * The month's dollars are summed and converted once at today's rate rather than each entry at the
 * rate of its own day. A budget is a decision about roughly how much to spend this month, and a
 * figure that shifted as old rates were re-read would be harder to reason about than one that is
 * a few pence out.
 */
export async function checkBudget(deps: BudgetDeps): Promise<BudgetState> {
  const now = (deps.now ?? (() => new Date()))();
  const settings = deps.settings ?? (await readSettings(deps.db));
  const cap = settings.ai.monthlyBudget;
  const resetsAt = nextMonthStart(now);

  if (!cap) return { ok: true, spentGbp: null, capGbp: null, resetsAt };

  const [row] = await deps.db
    .select({ total: sql<string>`coalesce(sum(${costLedger.costUsd}), 0)` })
    .from(costLedger)
    .where(and(gte(costLedger.createdAt, monthStart(now)), lt(costLedger.createdAt, resetsAt)));

  const spentUsd = Number(row?.total ?? 0);
  if (spentUsd === 0) return { ok: true, spentGbp: 0, capGbp: cap.amount, resetsAt };

  const converted = await deps.converter.toGbp(spentUsd, 'USD');
  if (!converted) {
    /**
     * No dollar rate has ever been stored, so the spend cannot be compared against a pound cap.
     * Reviews continue: stopping every review because a rates service was unreachable would turn
     * a cosmetic outage into an outage of the whole product, and the cap is a guardrail rather
     * than a hard credit limit.
     */
    deps.logger.warn('cannot check the AI budget: no USD rate is stored, so reviews continue', {
      spentUsd,
    });
    return { ok: true, spentGbp: null, capGbp: cap.amount, resetsAt };
  }

  return {
    ok: converted.amountGbp < cap.amount,
    spentGbp: converted.amountGbp,
    capGbp: cap.amount,
    resetsAt,
  };
}

/**
 * Records that the cap stopped reviews, at most once per month.
 *
 * The unique index on (kind, dedupe_key) is what enforces that: fifty review jobs meeting an
 * exhausted budget in one month write one row between them, and the fifty-first is a no-op rather
 * than a fifty-first email.
 */
export async function recordBudgetExceeded(
  db: Database,
  state: BudgetState,
  now: Date,
): Promise<boolean> {
  const spent = state.spentGbp === null ? 'an unknown amount' : `£${state.spentGbp.toFixed(2)}`;

  const written = await db
    .insert(events)
    .values({
      kind: 'budget_exceeded',
      level: 'warning',
      dedupeKey: budgetPeriod(now),
      message: `The monthly AI budget of £${state.capGbp?.toFixed(2)} is spent (${spent}). Reviews are paused until ${state.resetsAt.toISOString().slice(0, 10)}, or until the cap is raised in Settings.`,
      data: {
        period: budgetPeriod(now),
        spentGbp: state.spentGbp,
        capGbp: state.capGbp,
        resetsAt: state.resetsAt.toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: events.id });

  return written.length > 0;
}

export class BudgetExceededError extends Error {
  override readonly name = 'BudgetExceededError';
  constructor(readonly state: BudgetState) {
    super(`the monthly AI budget is spent; reviews resume ${state.resetsAt.toISOString()}`);
  }
}

/**
 * The guard a review job runs before it spends anything.
 *
 * Throws when the cap is reached, having written the event; the job handler turns that into a
 * deferral (see `withBudgetGuard`). Checked before the call rather than after, because the point is
 * not to make the call.
 */
export async function assertWithinBudget(deps: BudgetDeps): Promise<BudgetState> {
  const now = (deps.now ?? (() => new Date()))();
  const state = await checkBudget(deps);
  if (state.ok) return state;

  const first = await recordBudgetExceeded(deps.db, state, now);
  if (first) {
    deps.logger.warn('monthly AI budget reached; reviews are paused', {
      spentGbp: state.spentGbp,
      capGbp: state.capGbp,
      resetsAt: state.resetsAt.toISOString(),
    });
  }

  throw new BudgetExceededError(state);
}

/**
 * Wraps a job handler so that reaching the cap defers the job instead of failing it.
 *
 * `defer` is supplied by the caller rather than a pg-boss handle taken here, so this package
 * stays free of the queue: P1-12 passes a function that re-sends the job with `startAfter`.
 * Anything else the handler throws is left alone — a budget guard must not swallow a real error.
 */
export function withBudgetGuard<T>(
  deps: BudgetDeps,
  defer: (resumeAt: Date) => Promise<void>,
  handler: () => Promise<T>,
): () => Promise<T | undefined> {
  return async () => {
    try {
      await assertWithinBudget(deps);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        await defer(error.state.resetsAt);
        return undefined;
      }
      throw error;
    }
    return handler();
  };
}
