import {
  type Converter,
  costLedger,
  createDb,
  createPool,
  createSilentLogger,
  type Database,
  events,
  runMigrations,
  settingsSchema,
  settings as settingsTable,
  writeSettings,
} from '@goodies-beacon/core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertWithinBudget,
  BudgetExceededError,
  budgetPeriod,
  checkBudget,
  monthStart,
  nextMonthStart,
  withBudgetGuard,
} from './budget.js';

/**
 * P1-08's budget cap, against a real database.
 *
 * The ledger sum, the month boundary and the at-most-once event all live in Postgres, so a fake
 * would be testing the fake. The rate is stubbed: the conversion itself is P1-06's and has its
 * own tests.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET_KEY = 'Z29vZGllcy1iZWFjb24tdGVzdC1rZXktMzJieXRlcyE=';
const logger = createSilentLogger();

/** A pound to the dollar, so the arithmetic in a test reads as the number that was written. */
const converter: Converter = {
  async toGbp(amount) {
    return { amountGbp: Math.round(amount * 100) / 100, rateDate: '2026-09-11' };
  },
  invalidate() {},
};

/** No rate has ever been stored, which must not stop reviews. */
const noRates: Converter = {
  async toGbp() {
    return null;
  },
  invalidate() {},
};

let pool: Pool | undefined;
let db: Database;

const NOW = new Date('2026-09-14T12:00:00.000Z');

afterAll(async () => {
  await pool?.end();
});

async function spend(costUsd: number, at: Date = NOW): Promise<void> {
  await db.insert(costLedger).values({
    role: 'reviewer',
    provider: 'openai',
    model: 'gpt-5-mini',
    costUsd: costUsd.toFixed(6),
    createdAt: at,
  });
}

async function setCap(amount: number | null): Promise<void> {
  await writeSettings(
    db,
    { ai: { monthlyBudget: amount === null ? null : { amount, currency: 'GBP' } } },
    SECRET_KEY,
  );
}

const deps = (overrides: Partial<Parameters<typeof checkBudget>[0]> = {}) => ({
  db,
  logger,
  converter,
  now: () => NOW,
  ...overrides,
});

describe.skipIf(!databaseUrl)('the monthly budget cap against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(costLedger);
    await db.delete(events);
    await db.delete(settingsTable);
  });

  it('allows spending when no cap is set', async () => {
    await spend(1000);

    const state = await checkBudget(deps());

    expect(state.ok).toBe(true);
    expect(state.capGbp).toBeNull();
  });

  it('allows spending below the cap', async () => {
    await setCap(1);
    await spend(0.5);

    const state = await checkBudget(deps());

    expect(state.ok).toBe(true);
    expect(state.spentGbp).toBeCloseTo(0.5, 2);
  });

  /** The done-when, exactly: a £1 cap and a ledger at £1.01. */
  it('stops at the cap, and writes one event however many jobs meet it', async () => {
    await setCap(1);
    await spend(1.01);

    const first = await assertWithinBudget(deps()).catch((error) => error);
    expect(first).toBeInstanceOf(BudgetExceededError);

    // Forty-nine more review jobs arriving in the same month.
    for (let n = 0; n < 49; n += 1) {
      await assertWithinBudget(deps()).catch(() => undefined);
    }

    const written = await db.select().from(events);
    expect(written).toHaveLength(1);
    expect(written[0]?.kind).toBe('budget_exceeded');
    expect(written[0]?.dedupeKey).toBe('2026-09');
    expect(written[0]?.message).toContain('£1.00');
  });

  it('defers the job rather than failing it, so nothing is lost', async () => {
    await setCap(1);
    await spend(1.01);

    const deferred: Date[] = [];
    let ran = false;
    const guarded = withBudgetGuard(
      deps(),
      async (resumeAt) => {
        deferred.push(resumeAt);
      },
      async () => {
        ran = true;
        return 'reviewed';
      },
    );

    const result = await guarded();

    expect(result).toBeUndefined();
    expect(ran).toBe(false);
    expect(deferred).toHaveLength(1);
    expect(deferred[0]?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('runs the job when there is room, and passes its result through', async () => {
    await setCap(100);
    await spend(1);

    const guarded = withBudgetGuard(
      deps(),
      async () => {
        throw new Error('should not defer');
      },
      async () => 'reviewed',
    );

    expect(await guarded()).toBe('reviewed');
  });

  /** A budget guard must not swallow a real failure and make it look like a deferral. */
  it('lets an error from the job itself through', async () => {
    await setCap(100);

    const guarded = withBudgetGuard(
      deps(),
      async () => undefined,
      async () => {
        throw new Error('the model was unreachable');
      },
    );

    await expect(guarded()).rejects.toThrow('the model was unreachable');
  });

  /** Last month's spending is last month's problem; the cap resets with the calendar. */
  it('counts this month only', async () => {
    await setCap(1);
    await spend(50, new Date('2026-08-20T00:00:00.000Z'));
    await spend(0.2);

    const state = await checkBudget(deps());

    expect(state.ok).toBe(true);
    expect(state.spentGbp).toBeCloseTo(0.2, 2);
  });

  it('writes a separate event for the next month, so a new cap can be reported', async () => {
    await setCap(1);
    await spend(1.01);
    await assertWithinBudget(deps()).catch(() => undefined);

    const october = new Date('2026-10-05T00:00:00.000Z');
    await spend(1.01, october);
    await assertWithinBudget(deps({ now: () => october })).catch(() => undefined);

    const written = await db.select().from(events);
    expect(written.map((row) => row.dedupeKey).sort()).toEqual(['2026-09', '2026-10']);
  });

  /**
   * A rates outage must not stop every review: the cap is a guardrail, not a credit limit, and
   * turning a cosmetic failure into a full stop is the worse of the two outcomes.
   */
  it('keeps reviewing when the spend cannot be converted, and says so', async () => {
    await setCap(1);
    await spend(1000);

    const state = await checkBudget(deps({ converter: noRates }));

    expect(state.ok).toBe(true);
    expect(state.spentGbp).toBeNull();
  });

  it('reads an empty ledger as nothing spent rather than as unknown', async () => {
    await setCap(1);

    const state = await checkBudget(deps());

    expect(state).toMatchObject({ ok: true, spentGbp: 0, capGbp: 1 });
  });
});

describe('the month boundary', () => {
  it('is the first instant of the month, in UTC', () => {
    expect(monthStart(NOW).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(nextMonthStart(NOW).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rolls over the year', () => {
    const december = new Date('2026-12-31T23:59:59.000Z');
    expect(nextMonthStart(december).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('keys an event by the calendar month', () => {
    expect(budgetPeriod(NOW)).toBe('2026-09');
  });
});

describe('the settings default', () => {
  it('has no cap until one is set, so a fresh instance is not blocked', () => {
    expect(settingsSchema.parse({}).ai.monthlyBudget).toBeNull();
  });
});
