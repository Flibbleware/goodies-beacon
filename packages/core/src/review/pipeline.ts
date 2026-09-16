import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { candidates, listings, media, specVersions, verdicts, wantedItems } from '../db/schema.js';
import type { CandidateStage, RejectionReason, VerdictDecision } from '../domain/constants.js';
import { decideVerdict } from '../domain/decide.js';
import type { ListingImage } from '../domain/listing.js';
import { type WantedSpec, wantedSpecSchema } from '../domain/spec.js';
import type { CriterionResultEntry } from '../domain/verdict.js';
import type { Logger } from '../logger.js';
import { fetchImage, MediaRejectedError, storeImage } from '../media/ingest.js';
import type { Converter } from '../money/convert.js';
import { recordPrefilterCost, recordReviewedCandidate } from '../poll/stats.js';
import { isSourceId, type SourceId } from '../sources.js';
import { notifyRealtime } from './notify.js';
import type { ReviewPortImage, ReviewPorts } from './ports.js';

/**
 * The `review` job (§7): one candidate, from a raw listing to a stored verdict and an email.
 *
 * Every stage can stop the pipeline early, which is where the cost control comes from — the hard
 * filters cost nothing, the pre-filter costs a fraction of a penny, and only what survives both
 * reaches the model that actually costs money.
 *
 * **Each stage is idempotent and its progress is recorded on the candidate**, because a retried
 * job must not double-spend. `stage` moves `new → prefiltered → enriched → reviewed`, a
 * re-delivered job resumes where the candidate got to, and one already `reviewed` is a no-op.
 * That is also why the verdict is written before the notification: the expensive work is banked
 * first, so a failure in the cheap step after it cannot cause the dear one to run twice.
 *
 * A candidate that *failed* starts again from the top, which is deliberate. `stage` holds one
 * value and §4 makes `failed` a terminal state of its own, so remembering how far a failed
 * candidate got would take a second column to say it. The cost of not having one is a pre-filter
 * call — a fraction of a penny — and an enrichment fetch whose images dedupe on their content
 * hash. The cost it cannot incur is a second *review*, because a review that succeeded has
 * already written its verdict and moved the candidate to `reviewed`.
 */

export interface ReviewDeps {
  db: Database;
  logger: Logger;
  converter: Converter;
  ports: ReviewPorts;
  /** Where P1-05 stores images, so the reviewer can be handed the bytes it already fetched. */
  mediaDir: string;
  /** For the candidate link in an email. */
  host: string;
  signal?: AbortSignal | undefined;
}

export type ReviewOutcome =
  | { status: 'skipped'; why: 'already-reviewed' | 'missing' | 'no-spec' }
  | { status: 'rejected'; reason: RejectionReason; decision: 'reject' }
  | { status: 'reviewed'; decision: VerdictDecision; notified: boolean };

/** Everything the pipeline needs about a candidate, read once. */
interface Loaded {
  candidate: typeof candidates.$inferSelect;
  listing: typeof listings.$inferSelect;
  item: typeof wantedItems.$inferSelect;
  spec: WantedSpec;
  specVersionId: string;
}

export async function runReview(deps: ReviewDeps, candidateId: string): Promise<ReviewOutcome> {
  const loaded = await load(deps, candidateId);
  if (!loaded) return { status: 'skipped', why: 'missing' };

  // Re-running a completed candidate does nothing, however the job got sent twice (§7).
  if (loaded.candidate.stage === 'reviewed') {
    deps.logger.debug('review skipped: this candidate already has a verdict', { candidateId });
    return { status: 'skipped', why: 'already-reviewed' };
  }

  try {
    const outcome = await stages(deps, loaded);
    return outcome;
  } catch (error) {
    /**
     * The candidate carries its own failure, so it is visible in the UI rather than only in a log
     * (§4's `error` column exists for this). The error is re-thrown so pg-boss retries it with
     * backoff; a stage that already succeeded is not repeated, because `stage` recorded it.
     */
    const message = error instanceof Error ? error.message : String(error);
    await mark(deps.db, loaded.candidate.id, 'failed', message);
    deps.logger.error('review failed', { candidateId, error: message });
    throw error;
  }
}

async function stages(deps: ReviewDeps, loaded: Loaded): Promise<ReviewOutcome> {
  const { candidate } = loaded;

  if (candidate.stage === 'new' || candidate.stage === 'failed') {
    const hard = await hardFilters(deps, loaded);
    if (hard) return hard;

    const prefiltered = await prefilter(deps, loaded);
    if (prefiltered) return prefiltered;

    await mark(deps.db, candidate.id, 'prefiltered');
  }

  if (candidate.stage !== 'enriched') {
    await enrich(deps, loaded);
    await mark(deps.db, candidate.id, 'enriched');
  }

  return review(deps, loaded);
}

/**
 * §7 step 2: the filters that cost nothing.
 *
 * A rejection here still writes a verdict with its reason, so "rejected, and here is why" is in
 * the audit view without pretending a model was consulted — the model columns stay null.
 *
 * Relist detection is the third thing §7 lists at this step and is **not** implemented here: the
 * task's own scope is the price ceiling and the negative keywords. It is also not simply missing
 * work, because §7 puts image-hash matching at step 2 while the images are not ingested until step
 * 4 — a new candidate has no hashes to match on yet, so only the title and seller are available
 * this early. Worth resolving before it is built.
 */
async function hardFilters(deps: ReviewDeps, loaded: Loaded): Promise<ReviewOutcome | null> {
  const { listing, spec } = loaded;
  const ceiling = spec.settings.priceCeiling;

  const priceGbp = await priceInGbp(deps, listing);
  if (ceiling && priceGbp !== null && priceGbp > ceiling.amount) {
    return stopEarly(deps, loaded, 'over_budget', `£${priceGbp.toFixed(2)} is over the ceiling`);
  }

  const title = listing.title.toLowerCase();
  const hit = spec.settings.negativeKeywords.find((word) =>
    title.includes(word.trim().toLowerCase()),
  );
  if (hit) {
    return stopEarly(deps, loaded, 'negative_keyword', `the title contains "${hit}"`);
  }

  return null;
}

/**
 * The price in GBP, converting it now if the poll could not.
 *
 * A listing normally arrives converted (P1-06 runs at ingest), so this is the case where the rate
 * was unavailable then. A price that still cannot be converted returns null and the ceiling does
 * not fire: §1's asymmetry again — showing the owner a listing that turns out to be too dear is a
 * great deal better than silently dropping one that was not.
 */
async function priceInGbp(
  deps: ReviewDeps,
  listing: typeof listings.$inferSelect,
): Promise<number | null> {
  if (listing.priceGbp !== null) return Number(listing.priceGbp);
  if (listing.priceAmount === null || !listing.priceCurrency) return null;

  try {
    const converted = await deps.converter.toGbp(
      Number(listing.priceAmount),
      listing.priceCurrency,
    );
    // No rate for that currency, even now. The ceiling does not fire on a price nobody can read.
    if (!converted) return null;

    await deps.db
      .update(listings)
      .set({ priceGbp: converted.amountGbp.toFixed(2), priceRateDate: converted.rateDate })
      .where(eq(listings.id, listing.id));
    return converted.amountGbp;
  } catch (error) {
    deps.logger.warn('could not convert the price; the ceiling was not applied', {
      listingId: listing.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** §7 step 3. A discard writes its verdict and stops; anything plausible or unclear continues. */
async function prefilter(deps: ReviewDeps, loaded: Loaded): Promise<ReviewOutcome | null> {
  const { candidate, listing, spec } = loaded;

  const result = await deps.ports.prefilter({
    listing: { title: listing.title, description: listing.description },
    spec,
    wantedItemId: candidate.wantedItemId,
    candidateId: candidate.id,
  });

  // Charged to the plan whichever way it went; only the ledger cares that it was this candidate.
  await recordPrefilterCost(deps.db, candidate.searchPlanId, result.costUsd);

  if (result.plausible) return null;

  return stopEarly(deps, loaded, 'prefilter', result.reason, {
    modelRole: 'prefilter' as const,
    model: result.modelRef,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.costUsd.toFixed(6),
  });
}

/** §7 step 4: the full description and every image, then the images stored under P1-05's guard. */
async function enrich(deps: ReviewDeps, loaded: Loaded): Promise<void> {
  const { listing } = loaded;
  if (!isSourceId(listing.source)) return;

  const enriched = await deps.ports
    .enrich(listing.source as SourceId, asRawListing(listing))
    .catch((error: unknown) => {
      /**
       * A source that cannot be enriched is reviewed on what the search result carried, rather
       * than not reviewed at all. The listing still has a title, a price and thumbnails; §1's
       * asymmetry says a thinner review beats none.
       */
      deps.logger.warn('enrichment failed; reviewing the search result as it stands', {
        listingId: listing.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

  if (enriched) {
    await deps.db
      .update(listings)
      .set({
        description: enriched.description ?? listing.description,
        descriptionEn: enriched.descriptionEn ?? listing.descriptionEn,
        images: enriched.images.length > 0 ? enriched.images : listing.images,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listing.id));

    loaded.listing = {
      ...listing,
      description: enriched.description ?? listing.description,
      images: enriched.images.length > 0 ? enriched.images : listing.images,
    };
  }

  await ingestImages(deps, loaded);
}

/**
 * Fetches and stores each listing image, recording the `mediaId` back onto the listing.
 *
 * One image failing does not fail the review. A marketplace serves dead thumbnails, oversized
 * files and the occasional thing that is not an image at all, and none of that is a reason to
 * never look at the listing — it reviews on the images that did arrive.
 */
async function ingestImages(deps: ReviewDeps, loaded: Loaded): Promise<void> {
  const images = (loaded.listing.images ?? []) as ListingImage[];
  if (images.length === 0) return;

  const stored: ListingImage[] = [];
  for (const image of images) {
    if (image.mediaId) {
      stored.push(image);
      continue;
    }

    try {
      const fetched = await fetchImage(image.url, {
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      const row = await storeImage({
        db: deps.db,
        mediaDir: deps.mediaDir,
        kind: 'listing',
        body: fetched.body,
        sourceUrl: image.url,
      });
      stored.push({ ...image, mediaId: row.id });
    } catch (error) {
      const expected = error instanceof MediaRejectedError;
      deps.logger[expected ? 'debug' : 'warn']('could not store a listing image', {
        listingId: loaded.listing.id,
        url: image.url,
        error: error instanceof Error ? error.message : String(error),
      });
      stored.push(image);
    }
  }

  await deps.db
    .update(listings)
    .set({ images: stored, updatedAt: new Date() })
    .where(eq(listings.id, loaded.listing.id));
  loaded.listing = { ...loaded.listing, images: stored };
}

/** §7 steps 5 to 7: the vision review, the deterministic decision, the verdict and the email. */
async function review(deps: ReviewDeps, loaded: Loaded): Promise<ReviewOutcome> {
  const { candidate, listing, spec } = loaded;

  const [listingImages, referenceImages] = await Promise.all([
    loadImages(
      deps,
      ((listing.images ?? []) as ListingImage[]).map((image) => image.mediaId),
    ),
    loadImages(
      deps,
      spec.referenceImages.map((image) => image.id),
      spec.referenceImages.map((image) => image.label),
    ),
  ]);

  const reviewed = await deps.ports.review({
    listing: {
      title: listing.title,
      description: listing.description,
      price: listing.priceGbp === null ? null : `£${Number(listing.priceGbp).toFixed(2)}`,
      url: listing.url,
      images: listingImages,
    },
    spec,
    referenceImages,
    wantedItemId: candidate.wantedItemId,
    candidateId: candidate.id,
  });

  // §7 step 6, and the only place a decision is made (P1-11).
  const { decision } = decideVerdict({
    criteria: spec.criteria,
    settings: spec.settings,
    criteriaResults: reviewed.criteriaResults,
    grade: reviewed.grade,
  });

  await deps.db.insert(verdicts).values({
    candidateId: candidate.id,
    specVersionId: loaded.specVersionId,
    decision,
    criteriaResults: reviewed.criteriaResults,
    grade: reviewed.grade,
    englishSummary: reviewed.englishSummary,
    modelRole: 'reviewer',
    model: reviewed.modelRef,
    promptText: reviewed.promptText,
    promptImages: reviewed.promptImages,
    inputTokens: reviewed.usage.inputTokens,
    outputTokens: reviewed.usage.outputTokens,
    costUsd: reviewed.costUsd.toFixed(6),
  });

  // Beside the verdict rather than after the mark: the two record the same event, and a crash
  // between them would leave the plan's tally disagreeing with the verdicts it is a tally of.
  await recordReviewedCandidate(deps.db, candidate.searchPlanId, decision);

  // Banked before the notification, so a failure to send can never cause a re-review.
  await mark(deps.db, candidate.id, 'reviewed');

  const notified = await maybeNotify(
    deps,
    loaded,
    decision,
    reviewed.criteriaResults,
    reviewed.englishSummary,
  );
  return { status: 'reviewed', decision, notified };
}

/**
 * §10, at the size P1-12 gives it: a `match` or `uncertain`, on a real-time item, from a poll.
 *
 * A `reject`, a digest-mode item and a backfill candidate all send nothing — a backfill is a
 * sweep of everything already listed, and mailing its results one at a time is how someone comes
 * to ignore the mail.
 */
async function maybeNotify(
  deps: ReviewDeps,
  loaded: Loaded,
  decision: VerdictDecision,
  criteriaResults: readonly CriterionResultEntry[],
  englishSummary: string,
): Promise<boolean> {
  const { candidate, item, listing, spec } = loaded;

  if (decision === 'reject') return false;
  if (item.notificationMode !== 'realtime') return false;
  if (candidate.origin !== 'poll') return false;

  try {
    return await notifyRealtime(
      { db: deps.db, logger: deps.logger, sendEmail: deps.ports.sendEmail },
      {
        candidateId: candidate.id,
        itemTitle: item.title,
        decision,
        listingTitle: listing.title,
        priceGbp: listing.priceGbp === null ? null : Number(listing.priceGbp).toFixed(2),
        listingUrl: listing.url,
        candidateUrl: `${deps.host}/candidates/${candidate.id}`,
        englishSummary,
        criteria: spec.criteria,
        criteriaResults,
      },
    );
  } catch (error) {
    /**
     * A review that succeeded is not turned into a failed candidate because the mail server was
     * down. The verdict is stored and visible, and the notification row is left with `sent_at`
     * null, which is the durable, queryable record of "claimed but never delivered".
     */
    deps.logger.error('the verdict was stored but the notification could not be sent', {
      candidateId: candidate.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Writes the verdict for a candidate stopped before the reviewer, and marks it done. */
async function stopEarly(
  deps: ReviewDeps,
  loaded: Loaded,
  reason: RejectionReason,
  why: string,
  model?: {
    modelRole: 'prefilter';
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
  },
): Promise<ReviewOutcome> {
  await deps.db.insert(verdicts).values({
    candidateId: loaded.candidate.id,
    specVersionId: loaded.specVersionId,
    decision: 'reject',
    reason,
    criteriaResults: [],
    englishSummary: why,
    ...(model ?? {}),
  });

  await mark(deps.db, loaded.candidate.id, 'reviewed');
  deps.logger.debug('candidate rejected before the reviewer', {
    candidateId: loaded.candidate.id,
    reason,
  });

  return { status: 'rejected', reason, decision: 'reject' };
}

async function mark(
  db: Database,
  candidateId: string,
  stage: CandidateStage,
  error?: string,
): Promise<void> {
  await db
    .update(candidates)
    .set({
      stage,
      error: error ? error.slice(0, 1_000) : null,
      updatedAt: sql`now()`,
    })
    .where(eq(candidates.id, candidateId));
}

/** Reads the stored bytes for each media id, skipping any whose file has gone. */
async function loadImages(
  deps: ReviewDeps,
  ids: readonly (string | null)[],
  labels: readonly string[] = [],
): Promise<ReviewPortImage[]> {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (wanted.length === 0) return [];

  const images: ReviewPortImage[] = [];
  for (const [index, id] of wanted.entries()) {
    const [row] = await deps.db.select().from(media).where(eq(media.id, id)).limit(1);
    if (!row) continue;

    try {
      const bytes = await readFile(join(deps.mediaDir, row.path));
      images.push({
        mediaId: row.id,
        label: labels[index] ?? row.label ?? '',
        bytes,
        mediaType: row.contentType,
      });
    } catch (error) {
      deps.logger.warn('a stored image could not be read; reviewing without it', {
        mediaId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return images;
}

async function load(deps: ReviewDeps, candidateId: string): Promise<Loaded | null> {
  const [candidate] = await deps.db
    .select()
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1);
  if (!candidate) {
    deps.logger.warn('review skipped: no such candidate', { candidateId });
    return null;
  }

  const [listing] = await deps.db
    .select()
    .from(listings)
    .where(eq(listings.id, candidate.listingId))
    .limit(1);
  const [item] = await deps.db
    .select()
    .from(wantedItems)
    .where(eq(wantedItems.id, candidate.wantedItemId))
    .limit(1);
  const [version] = await deps.db
    .select()
    .from(specVersions)
    .where(eq(specVersions.id, candidate.specVersionId))
    .limit(1);

  if (!listing || !item || !version) {
    deps.logger.warn('review skipped: the candidate is missing its listing, item or spec', {
      candidateId,
    });
    return null;
  }

  return {
    candidate,
    listing,
    item,
    spec: wantedSpecSchema.parse({
      summary: version.summary,
      plausibilityNote: version.plausibilityNote,
      settings: version.settings,
      criteria: version.criteria,
      searchPlans: version.searchPlans,
      referenceImages: version.referenceImages,
    }),
    specVersionId: version.id,
  };
}

/** The stored listing in the shape an adapter's `enrich` expects back. */
function asRawListing(listing: typeof listings.$inferSelect) {
  return {
    source: listing.source,
    externalId: listing.externalId,
    url: listing.url,
    title: listing.title,
    titleEn: listing.titleEn,
    description: listing.description,
    descriptionEn: listing.descriptionEn,
    priceAmount: listing.priceAmount === null ? null : Number(listing.priceAmount),
    priceCurrency: listing.priceCurrency,
    buyingType: listing.buyingType,
    sellerHash: listing.sellerHash,
    itemLocationCountry: listing.itemLocationCountry,
    shipsToUk: listing.shipsToUk,
    images: (listing.images ?? []) as ListingImage[],
    listedAt: listing.listedAt,
    endsAt: listing.endsAt,
    raw: listing.raw,
  } as Parameters<ReviewPorts['enrich']>[1];
}
