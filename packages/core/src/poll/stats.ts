import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { searchPlanState } from '../db/schema.js';
import type { VerdictDecision } from '../domain/constants.js';

/**
 * The half of a plan's stats the review worker owns (§4).
 *
 * `candidatesFound` is written by the poll, because that is where a candidate is created. The
 * rest can only be known later: whether it reached the vision review, what the verdict was, and
 * what the pre-filter charged for the privilege of finding out. Without these the item page can
 * say a query found four hundred listings and nothing about whether any of them were worth it,
 * which is the question "is 'mac performa' earning its keep" actually asks.
 *
 * A candidate from a backfill or a scan has no plan, so its `searchPlanId` is null and these do
 * nothing — the counters are per query, and a sweep is not one.
 */

/**
 * Charges a pre-filter call to the plan, whatever it decided.
 *
 * Every call is billed, so every call is counted: recording only the discards would make the
 * cheapest queries look dearest, since a query whose listings are all plausible would show a
 * pre-filter cost of zero while paying for one call each.
 */
export async function recordPrefilterCost(
  db: Database,
  planId: string | null,
  costUsd: number,
): Promise<void> {
  if (planId === null || costUsd === 0) return;

  await db
    .update(searchPlanState)
    .set({
      prefilterCostUsd: sql`${searchPlanState.prefilterCostUsd} + ${costUsd.toFixed(6)}`,
      updatedAt: new Date(),
    })
    .where(eq(searchPlanState.planId, planId));
}

/**
 * One candidate that reached the vision review, and what the rules made of it.
 *
 * "Reviewed" is §4's "reached vision review", not "has a verdict": a candidate rejected by the
 * price ceiling or discarded by the pre-filter also ends with a verdict, and counting those here
 * would bury the number that matters — how many of this query's listings were expensive enough
 * to look at.
 */
export async function recordReviewedCandidate(
  db: Database,
  planId: string | null,
  decision: VerdictDecision,
): Promise<void> {
  if (planId === null) return;

  await db
    .update(searchPlanState)
    .set({
      candidatesReviewed: sql`${searchPlanState.candidatesReviewed} + 1`,
      ...(decision === 'match'
        ? { candidatesMatched: sql`${searchPlanState.candidatesMatched} + 1` }
        : {}),
      ...(decision === 'uncertain'
        ? { candidatesUncertain: sql`${searchPlanState.candidatesUncertain} + 1` }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(searchPlanState.planId, planId));
}
