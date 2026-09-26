import { and, count, desc, eq, gte, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { candidates, listings, specVersions, verdicts, wantedItems } from '../db/schema.js';
import { decideVerdict } from '../domain/decide.js';
import type { ListingImage } from '../domain/listing.js';
import { type Criterion, criterionSchema, specSettingsSchema } from '../domain/spec.js';
import type { CriterionResultEntry } from '../domain/verdict.js';
import type {
  CandidateDetail,
  CandidateFilter,
  CandidateList,
  CandidateRow,
  CriterionEvidence,
  ListingView,
  VerdictView,
} from './schema.js';

/**
 * Reading candidates and their verdicts — requirement 6's audit view (P1-15).
 *
 * "Everything the reviewer rejected is visible in the web UI so you can audit it" is the point,
 * so a rejection is read by exactly the same path as a match and nothing here treats `reject` as
 * a case to hide. The verdict a candidate is *filtered* by is its newest one, because §4 makes
 * re-reviews append and the latest authoritative.
 */

/** The newest verdict per candidate, as a joinable subquery. */
function latestVerdicts(db: Database) {
  return db
    .selectDistinctOn([verdicts.candidateId], {
      candidateId: verdicts.candidateId,
      decision: verdicts.decision,
      reason: verdicts.reason,
      englishSummary: verdicts.englishSummary,
      grade: verdicts.grade,
      createdAt: verdicts.createdAt,
    })
    .from(verdicts)
    .orderBy(verdicts.candidateId, desc(verdicts.createdAt), desc(verdicts.id))
    .as('latest');
}

/**
 * The candidate list. `since` is the start of the owner's day, required when the filter asks for
 * `today` — the time zone is a setting, which this module does not read — and ignored otherwise.
 */
export async function listCandidates(
  db: Database,
  filter: CandidateFilter,
  since?: Date,
): Promise<CandidateList> {
  if (filter.from === 'today' && !since) throw new Error("listing today needs the day's start");
  const latest = latestVerdicts(db);

  const where = and(
    ...[
      filter.wantedItemId ? eq(candidates.wantedItemId, filter.wantedItemId) : undefined,
      filter.origin === 'all' ? undefined : eq(candidates.origin, filter.origin),
      filter.retained === null ? undefined : eq(candidates.retain, filter.retained),
      filter.decision === 'all'
        ? undefined
        : filter.decision === 'pending'
          ? isNull(latest.decision)
          : eq(latest.decision, filter.decision),
      // The same dating as the dashboard's Today tiles, so a tile and the list it opens agree.
      since && filter.from === 'today'
        ? or(
            gte(latest.createdAt, since),
            and(isNull(latest.createdAt), gte(candidates.createdAt, since)),
          )
        : undefined,
    ].filter((clause) => clause !== undefined),
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        candidate: candidates,
        listing: listings,
        itemTitle: wantedItems.title,
        decision: latest.decision,
        reason: latest.reason,
        englishSummary: latest.englishSummary,
        grade: latest.grade,
      })
      .from(candidates)
      .innerJoin(listings, eq(listings.id, candidates.listingId))
      .innerJoin(wantedItems, eq(wantedItems.id, candidates.wantedItemId))
      .leftJoin(latest, eq(latest.candidateId, candidates.id))
      .where(where)
      .orderBy(desc(candidates.createdAt), desc(candidates.id))
      .limit(filter.limit)
      .offset(filter.offset),
    db
      .select({ total: count() })
      .from(candidates)
      .leftJoin(latest, eq(latest.candidateId, candidates.id))
      .where(where),
  ]);

  return {
    rows: rows.map(
      (row): CandidateRow => ({
        ...base(row.candidate, row.itemTitle, row.listing),
        decision: row.decision,
        reason: row.reason,
        englishSummary: row.englishSummary,
        grade: row.grade,
      }),
    ),
    total: totals[0]?.total ?? 0,
  };
}

export async function loadCandidate(
  db: Database,
  id: string,
): Promise<CandidateDetail | undefined> {
  const [row] = await db
    .select({
      candidate: candidates,
      listing: listings,
      itemTitle: wantedItems.title,
      specVersion: specVersions.version,
      criteria: specVersions.criteria,
      settings: specVersions.settings,
    })
    .from(candidates)
    .innerJoin(listings, eq(listings.id, candidates.listingId))
    .innerJoin(wantedItems, eq(wantedItems.id, candidates.wantedItemId))
    .innerJoin(specVersions, eq(specVersions.id, candidates.specVersionId))
    .where(eq(candidates.id, id))
    .limit(1);

  if (!row) return undefined;

  const stored = await db
    .select()
    .from(verdicts)
    .where(eq(verdicts.candidateId, id))
    .orderBy(desc(verdicts.createdAt), desc(verdicts.id));

  const criteria = parseCriteria(row.criteria);

  return {
    ...base(row.candidate, row.itemTitle, row.listing),
    specVersion: row.specVersion,
    searchPlanId: row.candidate.searchPlanId,
    error: row.candidate.error,
    verdicts: stored.map((verdict) => view(verdict, criteria, row.settings)),
  };
}

/** The Retain toggle (§13): a retained candidate survives the nightly retention sweep. */
export async function setRetain(
  db: Database,
  id: string,
  retain: boolean,
): Promise<boolean | undefined> {
  const [row] = await db
    .update(candidates)
    .set({ retain, updatedAt: new Date() })
    .where(eq(candidates.id, id))
    .returning({ retain: candidates.retain });

  return row?.retain;
}

function base(
  candidate: typeof candidates.$inferSelect,
  itemTitle: string,
  listing: typeof listings.$inferSelect,
): Omit<CandidateRow, 'decision' | 'reason' | 'englishSummary' | 'grade'> {
  return {
    id: candidate.id,
    wantedItemId: candidate.wantedItemId,
    itemTitle,
    origin: candidate.origin,
    stage: candidate.stage,
    retain: candidate.retain,
    relistOf: candidate.relistOf,
    createdAt: candidate.createdAt,
    listing: listingView(listing),
  };
}

function listingView(listing: typeof listings.$inferSelect): ListingView {
  return {
    id: listing.id,
    source: listing.source,
    url: listing.url,
    title: listing.title,
    titleEn: listing.titleEn,
    description: listing.description,
    descriptionEn: listing.descriptionEn,
    priceGbp: listing.priceGbp,
    priceAmount: listing.priceAmount,
    priceCurrency: listing.priceCurrency,
    buyingType: listing.buyingType,
    itemLocationCountry: listing.itemLocationCountry,
    shipsToUk: listing.shipsToUk,
    /**
     * Only the stored ones. An image whose fetch was refused by P1-05's guard has no `mediaId`,
     * and the page has nothing to show for it — it will not go and get the marketplace's copy,
     * which would be the SSRF the guard exists to prevent, moved into the browser.
     */
    images: ((listing.images ?? []) as ListingImage[])
      .map((image) => image.mediaId)
      .filter((mediaId): mediaId is string => typeof mediaId === 'string'),
    listedAt: listing.listedAt,
    endsAt: listing.endsAt,
  };
}

/**
 * A stored verdict with its reasons put back.
 *
 * `reasons` is derived rather than stored (see `verdict.ts`): `decideVerdict` is pure, the spec
 * version is immutable, and the per-criterion results are on the row — so re-running the rules
 * reproduces exactly what they said, for nothing, and there is no second copy to drift.
 */
function view(
  verdict: typeof verdicts.$inferSelect,
  criteria: Criterion[],
  settings: Record<string, unknown>,
): VerdictView {
  const results = (verdict.criteriaResults ?? []) as CriterionResultEntry[];
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));

  const parsedSettings = specSettingsSchema.safeParse(settings);
  const reasons = parsedSettings.success
    ? decideVerdict({
        criteria,
        settings: parsedSettings.data,
        criteriaResults: results,
        grade: verdict.grade,
      }).reasons
    : [];

  return {
    id: verdict.id,
    decision: verdict.decision,
    reason: verdict.reason,
    // A hard filter stopped the candidate before any criterion was asked; its own reason says why.
    reasons: verdict.reason === null ? reasons : [],
    criteriaResults: results.map(
      (result): CriterionEvidence => ({
        criterionId: result.criterionId,
        criterion: byId.get(result.criterionId) ?? null,
        result: result.result,
        evidence: result.evidence,
      }),
    ),
    grade: verdict.grade,
    englishSummary: verdict.englishSummary,
    modelRole: verdict.modelRole,
    model: verdict.model,
    promptText: verdict.promptText,
    promptImages: (
      (verdict.promptImages ?? []) as {
        mediaId?: unknown;
        label?: unknown;
        kind?: unknown;
      }[]
    )
      .filter((image) => typeof image.mediaId === 'string')
      .map((image) => ({
        mediaId: image.mediaId as string,
        label: typeof image.label === 'string' ? image.label : '',
        kind: typeof image.kind === 'string' ? image.kind : 'listing',
      })),
    inputTokens: verdict.inputTokens,
    outputTokens: verdict.outputTokens,
    costUsd: verdict.costUsd,
    createdAt: verdict.createdAt,
  };
}

function parseCriteria(raw: unknown[]): Criterion[] {
  return raw.flatMap((entry) => {
    const parsed = criterionSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
