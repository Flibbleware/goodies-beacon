import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AdapterContext, SourceAdapter } from '../adapter/types.js';
import type { Database } from '../db/client.js';
import { candidates, listings, verdicts } from '../db/schema.js';
import type { ListingAvailability } from '../domain/constants.js';
import type { Logger } from '../logger.js';
import type { SourceId } from '../sources.js';

/**
 * The two-hourly availability check (P1-38): has a listing the owner was told about sold, or gone?
 *
 * Only listings behind a match or an uncertain verdict are asked about — those are the ones the
 * owner might still buy — and only while they are still available, since nothing comes back.
 */

export const AVAILABILITY_CRON = '0 */2 * * *';

/**
 * eBay has no batch lookup this keyset may use (`getItems` answers 403), so each listing is one
 * call against a quota of 5,000 a day. A hundred every two hours is at most 1,200 a day; past
 * that the oldest-checked go first, so every listing is still asked in turn, just less often.
 */
export const AVAILABILITY_CHECK_LIMIT = 100;

export interface AvailabilityOutcome {
  checked: number;
  sold: number;
  ended: number;
  failed: number;
}

export interface RunAvailabilityCheckOptions {
  db: Database;
  source: SourceId;
  adapter: SourceAdapter;
  ctx: AdapterContext;
  logger: Logger;
  limit?: number;
  now?: () => Date;
}

/** The listings due a check on one source, oldest-checked first. */
export async function listingsDueACheck(db: Database, source: SourceId, limit: number) {
  const latest = db
    .selectDistinctOn([verdicts.candidateId], {
      candidateId: verdicts.candidateId,
      decision: verdicts.decision,
    })
    .from(verdicts)
    .orderBy(verdicts.candidateId, desc(verdicts.createdAt), desc(verdicts.id))
    .as('latest');

  const surfaced = db
    .select({ listingId: candidates.listingId })
    .from(candidates)
    .innerJoin(latest, eq(latest.candidateId, candidates.id))
    .where(inArray(latest.decision, ['match', 'uncertain']));

  return db
    .select({
      id: listings.id,
      externalId: listings.externalId,
      url: listings.url,
      buyingType: listings.buyingType,
      endsAt: listings.endsAt,
    })
    .from(listings)
    .where(
      and(
        eq(listings.source, source),
        eq(listings.availability, 'available'),
        inArray(listings.id, surfaced),
      ),
    )
    .orderBy(sql`${listings.availabilityCheckedAt} asc nulls first`, asc(listings.id))
    .limit(limit);
}

/**
 * Asks the source about each listing due a check and records what it says. One listing failing is
 * logged and the run goes on; a run in which every listing failed throws, so the job is marked
 * failed rather than reading as a quiet success — that is a keyset or a network, not a listing.
 */
export async function runAvailabilityCheck(
  options: RunAvailabilityCheckOptions,
): Promise<AvailabilityOutcome> {
  const { db, source, adapter, ctx, logger } = options;
  const now = options.now ?? (() => new Date());
  const outcome: AvailabilityOutcome = { checked: 0, sold: 0, ended: 0, failed: 0 };
  if (!adapter.checkAvailability) return outcome;

  const due = await listingsDueACheck(db, source, options.limit ?? AVAILABILITY_CHECK_LIMIT);
  let lastError: unknown;

  for (const listing of due) {
    if (ctx.signal?.aborted) break;

    let availability: ListingAvailability;
    try {
      availability = await adapter.checkAvailability(listing, ctx);
    } catch (error) {
      outcome.failed += 1;
      lastError = error;
      logger.warn('availability check failed', {
        listingId: listing.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Stamped all the same, so a listing that always fails moves to the back of the queue
      // instead of taking a place at the front of every run.
      await db
        .update(listings)
        .set({ availabilityCheckedAt: now() })
        .where(eq(listings.id, listing.id));
      continue;
    }

    const at = now();
    await db
      .update(listings)
      .set({
        availability,
        availabilityCheckedAt: at,
        ...(availability === 'available' ? {} : { unavailableAt: at }),
      })
      .where(eq(listings.id, listing.id));

    outcome.checked += 1;
    if (availability === 'sold') outcome.sold += 1;
    if (availability === 'ended') outcome.ended += 1;
  }

  logger.info('availability checked', { source, due: due.length, ...outcome });
  if (due.length > 0 && outcome.failed === due.length) throw lastError;
  return outcome;
}
