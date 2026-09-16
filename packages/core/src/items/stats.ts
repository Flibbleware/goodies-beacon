import { asc, eq, max, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { searchPlanState } from '../db/schema.js';
import { searchPlanSchema } from '../domain/spec.js';
import type { CandidateCounts, PlanStats, PollState } from './schema.js';

/**
 * What an item and its queries have actually done (P1-14).
 *
 * Two different questions, deliberately answered from two different places. The **counts** come
 * from the candidates and their verdicts, so they say what is in the instance right now and agree
 * with what P1-15's list will show. The **per-plan stats** come from `search_plan_state`, which is
 * a running tally that outlives the candidates retention deletes — "this query found four hundred
 * listings since March" is not a question the candidate table can still answer in April.
 */

/**
 * Candidate counts per item, keyed by item id.
 *
 * The decision comes from each candidate's *latest* verdict, because §4 makes re-reviews append
 * and the newest authoritative — counting every verdict row would let one re-reviewed candidate
 * appear as both a rejection and a match.
 */
export async function candidateCounts(
  db: Database,
  wantedItemId?: string,
): Promise<Map<string, CandidateCounts>> {
  const rows = await db.execute<{
    wantedItemId: string;
    candidates: number;
    matched: number;
    uncertain: number;
    rejected: number;
    pending: number;
  }>(sql`
    with latest as (
      select distinct on (candidate_id) candidate_id, decision
      from verdicts
      order by candidate_id, created_at desc, id desc
    )
    select c.wanted_item_id                                          as "wantedItemId",
           count(*)::int                                             as "candidates",
           count(*) filter (where l.decision = 'match')::int          as "matched",
           count(*) filter (where l.decision = 'uncertain')::int      as "uncertain",
           count(*) filter (where l.decision = 'reject')::int         as "rejected",
           count(*) filter (where l.decision is null)::int            as "pending"
    from candidates c
    left join latest l on l.candidate_id = c.id
    ${wantedItemId ? sql`where c.wanted_item_id = ${wantedItemId}` : sql``}
    group by c.wanted_item_id
  `);

  return new Map(
    rows.rows.map((row) => [
      row.wantedItemId,
      {
        candidates: Number(row.candidates),
        matched: Number(row.matched),
        uncertain: Number(row.uncertain),
        rejected: Number(row.rejected),
        pending: Number(row.pending),
      },
    ]),
  );
}

/** When each item last polled, and how many of its plans are failing, keyed by item id. */
export async function pollStates(db: Database): Promise<Map<string, PollState>> {
  const rows = await db
    .select({
      wantedItemId: searchPlanState.wantedItemId,
      lastPollAt: max(searchPlanState.lastRunAt),
      lastSuccessAt: max(searchPlanState.lastSuccessAt),
      failingPlans: sql<number>`count(*) filter (where ${searchPlanState.lastError} is not null)`,
    })
    .from(searchPlanState)
    .groupBy(searchPlanState.wantedItemId);

  return new Map(
    rows.map((row) => [
      row.wantedItemId,
      {
        lastPollAt: row.lastPollAt,
        lastSuccessAt: row.lastSuccessAt,
        failingPlans: Number(row.failingPlans),
      },
    ]),
  );
}

/**
 * The item's search plans with their stats: every plan in the current spec, whether it has ever
 * run or not, plus any plan that has state but has since been taken out of the spec.
 */
export async function planStats(
  db: Database,
  wantedItemId: string,
  specPlans: readonly unknown[],
): Promise<PlanStats[]> {
  const state = await db
    .select()
    .from(searchPlanState)
    .where(eq(searchPlanState.wantedItemId, wantedItemId))
    .orderBy(asc(searchPlanState.planId));

  const byId = new Map(state.map((row) => [row.planId, row]));
  const rows: PlanStats[] = [];
  const seen = new Set<string>();

  for (const raw of specPlans) {
    const parsed = searchPlanSchema.safeParse(raw);
    if (!parsed.success) continue;

    const plan = parsed.data;
    seen.add(plan.id);
    rows.push(merge(plan.id, plan.source, plan.query, plan.region, plan.enabled, true, byId));
  }

  for (const row of state) {
    if (seen.has(row.planId)) continue;
    rows.push(merge(row.planId, row.source, '', '', false, false, byId));
  }

  return rows;
}

function merge(
  planId: string,
  source: string,
  query: string,
  region: string,
  enabled: boolean,
  inSpec: boolean,
  byId: Map<string, typeof searchPlanState.$inferSelect>,
): PlanStats {
  const row = byId.get(planId);

  return {
    planId,
    source,
    query,
    region,
    enabled,
    inSpec,
    watermark: row?.watermark ?? null,
    backlogUntil: row?.backlogUntil ?? null,
    lastRunAt: row?.lastRunAt ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    lastError: row?.lastError ?? null,
    candidatesFound: row?.candidatesFound ?? 0,
    candidatesReviewed: row?.candidatesReviewed ?? 0,
    candidatesMatched: row?.candidatesMatched ?? 0,
    candidatesUncertain: row?.candidatesUncertain ?? 0,
    prefilterCostUsd: row?.prefilterCostUsd ?? '0',
  };
}
