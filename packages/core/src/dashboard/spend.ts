import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AiRole } from '../domain/constants.js';
import { startOfDayIn } from '../domain/time.js';
import { latestRate } from '../money/rates.js';
import type { RoleSpend, SpendBreakdown, SpendFigure } from './schema.js';

export interface SpendOptions {
  timezone: string;
  now?: Date;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The pre-filter runs on every listing and the reviewer on what survives it; then the chat. */
const PIPELINE_ORDER: readonly AiRole[] = ['prefilter', 'reviewer', 'interviewer'];

/**
 * The AI spend by role over today, the last seven days and the month (P1-33, §14).
 *
 * The month is the budget cap's — UTC, from `budget.ts` in `@goodies-beacon/ai` — and is restated
 * here rather than imported, because core cannot depend on ai.
 */
export async function spendBreakdown(db: Database, options: SpendOptions): Promise<SpendBreakdown> {
  const now = options.now ?? new Date();
  const today = startOfDayIn(options.timezone, now);
  const week = new Date(now.getTime() - WEEK_MS);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const earliest = new Date(Math.min(today.getTime(), week.getTime(), month.getTime()));

  const [rows, rate] = await Promise.all([
    db
      .execute<Record<string, string | number | boolean | null>>(sql`
        select
          role,
          count(*) filter (where created_at >= ${today})::int as today_calls,
          coalesce(sum(cost_usd) filter (where created_at >= ${today}), 0) as today_usd,
          coalesce(bool_and(cost_known) filter (where created_at >= ${today}), true) as today_known,
          count(*) filter (where created_at >= ${week})::int as week_calls,
          coalesce(sum(cost_usd) filter (where created_at >= ${week}), 0) as week_usd,
          coalesce(bool_and(cost_known) filter (where created_at >= ${week}), true) as week_known,
          count(*) filter (where created_at >= ${month})::int as month_calls,
          coalesce(sum(cost_usd) filter (where created_at >= ${month}), 0) as month_usd,
          coalesce(bool_and(cost_known) filter (where created_at >= ${month}), true) as month_known
        from cost_ledger
        where created_at >= ${earliest}
        group by role
      `)
      .then((result) => result.rows),
    latestRate(db, 'USD'),
  ]);

  const figure = (row: Record<string, unknown>, period: string): SpendFigure => ({
    calls: Number(row[`${period}_calls`] ?? 0),
    usd: Number(row[`${period}_usd`] ?? 0),
    known: row[`${period}_known`] !== false,
  });

  const byRole = new Map(rows.map((row) => [row.role, row]));
  const roles: RoleSpend[] = PIPELINE_ORDER.flatMap((role) => {
    const row = byRole.get(role);
    return row
      ? [
          {
            role,
            today: figure(row, 'today'),
            week: figure(row, 'week'),
            month: figure(row, 'month'),
          },
        ]
      : [];
  });

  return { roles, usdPerGbp: rate?.unitsPerGbp ?? null };
}
