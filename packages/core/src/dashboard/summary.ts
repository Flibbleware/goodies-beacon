import { count, desc, eq, isNotNull, max, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { processHeartbeat, searchPlanState, wantedItems } from '../db/schema.js';
import { startOfDayIn } from '../domain/time.js';
import type { Logger } from '../logger.js';
import { activePlans } from '../poll/plans.js';
import { HEARTBEAT_STALE_AFTER_MS } from '../queue/heartbeat.js';
import type { SourceId } from '../sources.js';
import type {
  DashboardSummary,
  ItemCounts,
  SourceHealth,
  TodayCounts,
  WorkerLiveness,
} from './schema.js';

/**
 * Everything the dashboard reads except the AI spend (§14, P1-16).
 *
 * The spend is missing on purpose: the budget cap lives in `@goodies-beacon/ai` because it needs
 * the price table, and core cannot depend on ai without a cycle. The API route joins the two.
 */

export interface SummaryOptions {
  /** The instance time zone, so "today" is the owner's day rather than UTC's. */
  timezone: string;
  now?: Date;
  staleAfterMs?: number;
  logger?: Logger;
}

export async function dashboardSummary(
  db: Database,
  options: SummaryOptions,
): Promise<DashboardSummary> {
  const now = options.now ?? new Date();
  const since = startOfDayIn(options.timezone, now);

  const [today, items, sources, workers] = await Promise.all([
    todayCounts(db, since),
    itemCounts(db),
    sourceHealth(db, options.logger),
    workerLiveness(db, now, options.staleAfterMs ?? HEARTBEAT_STALE_AFTER_MS),
  ]);

  return { today, items, sources, workers, timezone: options.timezone };
}

/**
 * What has been judged since local midnight, by each candidate's newest verdict.
 *
 * Dated by the *verdict*, not by the candidate: a listing found last night and reviewed this
 * morning is today's news, and a re-review today of a candidate from March is too.
 */
export async function todayCounts(db: Database, since: Date): Promise<TodayCounts> {
  const [row] = await db
    .execute<{
      matched: number;
      uncertain: number;
      rejected: number;
      waiting: number;
    }>(sql`
    with latest as (
      select distinct on (candidate_id) candidate_id, decision, created_at
      from verdicts
      order by candidate_id, created_at desc, id desc
    )
    select
      count(*) filter (where l.decision = 'match'     and l.created_at >= ${since})::int as "matched",
      count(*) filter (where l.decision = 'uncertain' and l.created_at >= ${since})::int as "uncertain",
      count(*) filter (where l.decision = 'reject'    and l.created_at >= ${since})::int as "rejected",
      count(*) filter (where l.decision is null       and c.created_at >= ${since})::int as "waiting"
    from candidates c
    left join latest l on l.candidate_id = c.id
  `)
    .then((result) => result.rows);

  return {
    matched: Number(row?.matched ?? 0),
    uncertain: Number(row?.uncertain ?? 0),
    rejected: Number(row?.rejected ?? 0),
    waiting: Number(row?.waiting ?? 0),
  };
}

export async function itemCounts(db: Database): Promise<ItemCounts> {
  const rows = await db
    .select({ status: wantedItems.status, total: count() })
    .from(wantedItems)
    .groupBy(wantedItems.status);

  const by = new Map(rows.map((row) => [row.status, Number(row.total)]));

  return {
    active: by.get('active') ?? 0,
    paused: by.get('paused') ?? 0,
    draft: by.get('draft') ?? 0,
    total: [...by.values()].reduce((sum, value) => sum + value, 0),
  };
}

/**
 * Per marketplace, and only the ones this instance actually has work for.
 *
 * The list is the union of two things, because neither alone is right. A source with plans in an
 * active spec but no poll yet must appear — "eBay, three plans, never polled" is exactly what a
 * fresh instance needs to see — and a source that has polled must appear even if its item has
 * since been paused, because its last error is still the last thing that happened.
 */
export async function sourceHealth(db: Database, logger?: Logger): Promise<SourceHealth[]> {
  const [plans, state, failing] = await Promise.all([
    activePlans(db, logger),
    db
      .select({
        source: searchPlanState.source,
        lastRunAt: max(searchPlanState.lastRunAt),
        lastSuccessAt: max(searchPlanState.lastSuccessAt),
        failingPlans: sql<number>`count(*) filter (where ${searchPlanState.lastError} is not null)`,
      })
      .from(searchPlanState)
      .groupBy(searchPlanState.source),
    // The newest failing plan per source, named so the page can link at the item that owns it.
    db
      .selectDistinctOn([searchPlanState.source], {
        source: searchPlanState.source,
        lastError: searchPlanState.lastError,
        wantedItemId: searchPlanState.wantedItemId,
        itemTitle: wantedItems.title,
      })
      .from(searchPlanState)
      .innerJoin(wantedItems, eq(wantedItems.id, searchPlanState.wantedItemId))
      .where(isNotNull(searchPlanState.lastError))
      .orderBy(searchPlanState.source, desc(searchPlanState.lastRunAt)),
  ]);

  const planned = new Map<SourceId, number>();
  for (const plan of plans) planned.set(plan.source, (planned.get(plan.source) ?? 0) + 1);

  const byState = new Map(state.map((row) => [row.source, row]));
  const byFailure = new Map(failing.map((row) => [row.source, row]));
  const names: SourceId[] = [...new Set([...planned.keys(), ...byState.keys()])].sort();

  return names.map((source) => {
    const stats = byState.get(source);
    const failure = byFailure.get(source);

    return {
      source,
      activePlans: planned.get(source) ?? 0,
      lastRunAt: stats?.lastRunAt ?? null,
      lastSuccessAt: stats?.lastSuccessAt ?? null,
      lastError: failure?.lastError ?? null,
      failingPlans: Number(stats?.failingPlans ?? 0),
      failingItemId: failure?.wantedItemId ?? null,
      failingItemTitle: failure?.itemTitle ?? null,
    };
  });
}

export async function workerLiveness(
  db: Database,
  now: Date,
  staleAfterMs: number,
): Promise<WorkerLiveness[]> {
  const rows = await db.select().from(processHeartbeat).orderBy(processHeartbeat.role);

  return rows.map((row) => ({
    role: row.role,
    lastSeenAt: row.lastSeenAt,
    stale: now.getTime() - row.lastSeenAt.getTime() > staleAfterMs,
  }));
}
