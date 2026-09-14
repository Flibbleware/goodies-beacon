import { and, eq, sql } from 'drizzle-orm';
import type { RawListing } from '../adapter/types.js';
import type { Database } from '../db/client.js';
import { candidates, listings, searchPlanState, seen } from '../db/schema.js';
import type { CandidateOrigin } from '../domain/constants.js';
import type { Logger } from '../logger.js';
import type { Converter } from '../money/convert.js';
import type { SourceId } from '../sources.js';

/**
 * Turning what an adapter returned into listings, candidates and review jobs (§6, §7 step 1).
 *
 * Deliberately in core rather than in the worker: it is pipeline logic, it is the half of a poll
 * worth testing against a real database, and keeping it here means the worker's job handler is
 * only plumbing — a context, a call, and this.
 */

export interface IngestDeps {
  readonly db: Database;
  readonly converter: Converter;
  readonly logger: Logger;
  /** Sends the review job (§3). Injected so core does not depend on a pg-boss instance. */
  readonly enqueueReview: (candidateId: string) => Promise<void>;
}

export interface IngestRequest {
  readonly wantedItemId: string;
  readonly specVersionId: string;
  readonly planId: string;
  readonly source: SourceId;
  readonly origin: CandidateOrigin;
  readonly listings: readonly RawListing[];
  /** The window this run searched, so a backlog can be recorded against the right floor. */
  readonly since: Date | null;
  /** True when the adapter stopped at the cap rather than reaching the end of the window. */
  readonly stoppedAtCap: boolean;
}

export interface IngestResult {
  processed: number;
  /** Listings this instance had never pulled before, from any plan. */
  newListings: number;
  /** Candidates created for this item — the number that reached the review queue. */
  newCandidates: number;
  watermark: Date | null;
  backlog: { from: Date; until: Date } | null;
}

/**
 * Store a poll's results and queue the new ones for review.
 *
 * Listings are processed oldest-first and the watermark is written once at the end, to the newest
 * one that actually made it through. A run killed half way — SIGTERM, a database blip — therefore
 * leaves the watermark at the last listing it finished, and the next run picks up exactly there
 * rather than skipping the remainder or redoing the lot.
 */
export async function ingestListings(
  deps: IngestDeps,
  request: IngestRequest,
): Promise<IngestResult> {
  const { db, logger } = deps;
  const ordered = [...request.listings].sort(byListedAtAscending);

  const result: IngestResult = {
    processed: 0,
    newListings: 0,
    newCandidates: 0,
    watermark: null,
    backlog: null,
  };

  let newest: Date | null = null;
  let oldest: Date | null = null;
  let completed = false;

  try {
    for (const listing of ordered) {
      const outcome = await ingestOne(deps, request, listing);
      result.processed += 1;
      if (outcome.newListing) result.newListings += 1;
      if (outcome.newCandidate) result.newCandidates += 1;

      if (listing.listedAt) {
        if (!newest || listing.listedAt > newest) newest = listing.listedAt;
        if (!oldest || listing.listedAt < oldest) oldest = listing.listedAt;
      }
    }
    completed = true;
  } finally {
    /**
     * In `finally` so a run that throws half way still records what it did finish. Without this a
     * poll that failed on its last listing would repeat the whole batch next time, and on a
     * listing that fails consistently it would never make progress at all.
     *
     * Its own failure must not replace the error that got us here, which is the one worth reading.
     */
    try {
      result.watermark = await advanceWatermark(db, request, newest, completed);
      if (result.newCandidates > 0) {
        await countCandidates(db, request.planId, result.newCandidates);
      }
    } catch (error) {
      logger.error('could not record the poll result', {
        planId: request.planId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!completed) return result;

  /**
   * A capped run leaves an older window unreached. The watermark still moves — the newest
   * listings really were processed — so the gap is recorded separately and drained by the next
   * runs before the fresh window is looked at again.
   */
  if (request.stoppedAtCap && request.since && oldest && oldest > request.since) {
    result.backlog = { from: request.since, until: oldest };
    logger.info('poll stopped at the cap; the older window is queued for the next run', {
      planId: request.planId,
      from: request.since.toISOString(),
      until: oldest.toISOString(),
    });
  }

  /**
   * Only a routine poll owns the backlog window. A backfill or a scan sweeps from the top with no
   * `since` at all, so it can neither create a backlog nor prove one has been drained — clearing
   * it here would lose a gap the polls were part way through.
   */
  if (request.origin === 'poll') {
    await db
      .update(searchPlanState)
      .set(
        result.backlog
          ? { backlogFrom: result.backlog.from, backlogUntil: result.backlog.until }
          : { backlogFrom: null, backlogUntil: null },
      )
      .where(eq(searchPlanState.planId, request.planId));
  }

  return result;
}

interface ListingOutcome {
  newListing: boolean;
  newCandidate: boolean;
}

async function ingestOne(
  deps: IngestDeps,
  request: IngestRequest,
  listing: RawListing,
): Promise<ListingOutcome> {
  const { db, converter, logger, enqueueReview } = deps;

  const converted =
    listing.priceAmount !== null && listing.priceCurrency
      ? await converter.toGbp(listing.priceAmount, listing.priceCurrency)
      : null;

  /**
   * `seen` is the instance's memory of every listing it has ever pulled, and is never pruned
   * (§4). It answers "is this new to us", which is not the same question as "is this new to this
   * wanted item" — two items searching the same marketplace will both meet the same listing, and
   * the per-item answer is the `candidates` unique index below.
   */
  const firstSight = await db
    .insert(seen)
    .values({ source: request.source, externalId: listing.externalId })
    .onConflictDoNothing()
    .returning({ externalId: seen.externalId });

  const [row] = await db
    .insert(listings)
    .values({
      source: request.source,
      externalId: listing.externalId,
      url: listing.url,
      title: listing.title,
      titleEn: listing.titleEn,
      description: listing.description,
      descriptionEn: listing.descriptionEn,
      priceAmount: numeric(listing.priceAmount),
      priceCurrency: listing.priceCurrency,
      priceGbp: numeric(converted?.amountGbp ?? null),
      priceRateDate: converted?.rateDate ?? null,
      buyingType: listing.buyingType,
      sellerHash: listing.sellerHash,
      itemLocationCountry: listing.itemLocationCountry,
      shipsToUk: listing.shipsToUk,
      images: listing.images,
      listedAt: listing.listedAt,
      endsAt: listing.endsAt,
      raw: listing.raw,
    })
    .onConflictDoUpdate({
      target: [listings.source, listings.externalId],
      // Only what a later sighting can legitimately revise. `firstSeenAt` is deliberately absent
      // — §6 updates `lastSeenAt` and nothing else about a listing's history — and so are the
      // description and the images, which a search result carries in summary and enrichment (§7
      // step 4) fills in properly; overwriting them here would undo the richer version.
      set: {
        url: sql`excluded.url`,
        title: sql`excluded.title`,
        priceAmount: sql`excluded.price_amount`,
        priceCurrency: sql`excluded.price_currency`,
        priceGbp: sql`excluded.price_gbp`,
        priceRateDate: sql`excluded.price_rate_date`,
        buyingType: sql`excluded.buying_type`,
        endsAt: sql`excluded.ends_at`,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: listings.id });

  if (!row) throw new Error(`listing upsert returned nothing for ${listing.externalId}`);

  const [candidate] = await db
    .insert(candidates)
    .values({
      wantedItemId: request.wantedItemId,
      listingId: row.id,
      specVersionId: request.specVersionId,
      searchPlanId: request.planId,
      origin: request.origin,
    })
    .onConflictDoNothing({ target: [candidates.wantedItemId, candidates.listingId] })
    .returning({ id: candidates.id });

  if (!candidate) return { newListing: firstSight.length > 0, newCandidate: false };

  /**
   * Sent after the row is committed, never before: a review job naming a candidate that does not
   * exist fails in the reviewer, where the cause is a long way from the effect.
   */
  await enqueueReview(candidate.id);
  logger.debug('candidate queued for review', {
    candidateId: candidate.id,
    externalId: listing.externalId,
  });

  return { newListing: firstSight.length > 0, newCandidate: true };
}

/** Never moves backwards: a backlog run processes listings older than the watermark by design. */
async function advanceWatermark(
  db: Database,
  request: IngestRequest,
  newest: Date | null,
  completed: boolean,
): Promise<Date | null> {
  const [state] = await db
    .update(searchPlanState)
    .set({
      ...(newest
        ? { watermark: sql`greatest(${searchPlanState.watermark}, ${newest}::timestamptz)` }
        : {}),
      lastRunAt: sql`now()`,
      // Only a run that finished counts as a success; a partial one leaves the last one standing
      // so the dashboard can say "failing since" rather than only "failed".
      ...(completed ? { lastSuccessAt: sql`now()`, lastError: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(searchPlanState.planId, request.planId))
    .returning({ watermark: searchPlanState.watermark });

  return state?.watermark ?? null;
}

async function countCandidates(db: Database, planId: string, found: number): Promise<void> {
  await db
    .update(searchPlanState)
    .set({
      candidatesFound: sql`${searchPlanState.candidatesFound} + ${found}`,
      updatedAt: new Date(),
    })
    .where(eq(searchPlanState.planId, planId));
}

/**
 * Oldest first, and listings with no date first of all.
 *
 * The order is what makes an interrupted run resumable: the watermark ends up at the newest
 * listing that finished, so whatever is left is strictly newer than it. A listing whose source
 * gave no date cannot move the watermark, so it goes first and is simply stored.
 */
function byListedAtAscending(a: RawListing, b: RawListing): number {
  if (!a.listedAt) return b.listedAt ? -1 : 0;
  if (!b.listedAt) return 1;
  return a.listedAt.getTime() - b.listedAt.getTime();
}

/** Drizzle's `numeric` columns take strings; a number would be stored via its JS formatting. */
function numeric(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/** Creates the per-plan row on first use, so a poll never has to check whether it exists. */
export async function ensurePlanState(
  db: Database,
  plan: { planId: string; wantedItemId: string; source: SourceId },
): Promise<typeof searchPlanState.$inferSelect> {
  await db
    .insert(searchPlanState)
    .values({ planId: plan.planId, wantedItemId: plan.wantedItemId, source: plan.source })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(searchPlanState)
    .where(
      and(
        eq(searchPlanState.planId, plan.planId),
        eq(searchPlanState.wantedItemId, plan.wantedItemId),
      ),
    )
    .limit(1);

  if (!row) throw new Error(`search plan state vanished for ${plan.planId}`);
  return row;
}

/**
 * Records a failed poll against the plan (§P1-07: adapter failures are health events, not silent).
 *
 * `lastSuccessAt` is left alone, so the dashboard can say "failing since" rather than only
 * "failed": a source that broke on Tuesday and has been retrying ever since reads as one incident.
 */
export async function recordPollFailure(
  db: Database,
  planId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(searchPlanState)
    .set({ lastRunAt: sql`now()`, lastError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(searchPlanState.planId, planId));
}
