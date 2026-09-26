import { z } from 'zod';
import {
  CANDIDATE_ORIGINS,
  type CandidateOrigin,
  type CandidateStage,
  type CriterionResult,
  type RejectionReason,
  type ShipsToUk,
  VERDICT_DECISIONS,
  type VerdictDecision,
} from '../domain/constants.js';
import type { Criterion } from '../domain/spec.js';
import type { SourceId } from '../sources.js';

/**
 * The audit view's shapes (P1-15).
 *
 * Requirement 6 is that a rejection is as easy to browse as a match — everything the reviewer
 * turned down stays visible, with the evidence it turned it down on. So the filters treat
 * `reject` as an ordinary value rather than a hidden default, and the list carries the same
 * fields whichever way a candidate went.
 */

/** `all` is a value rather than an absent parameter, so a link can say what it is showing. */
export const candidateFilterSchema = z.object({
  wantedItemId: z.uuid().nullable().default(null),
  decision: z.enum([...VERDICT_DECISIONS, 'pending', 'all']).default('all'),
  origin: z.enum([...CANDIDATE_ORIGINS, 'all']).default('all'),
  /**
   * `today` is the owner's day, dated as the dashboard dates it: by the newest verdict, or by when
   * the candidate was found if it has none yet. The caller resolves the day's start (P1-25).
   */
  from: z.enum(['today', 'all']).default('all'),
  retained: z.coerce.boolean().nullable().default(null),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CandidateFilter = z.infer<typeof candidateFilterSchema>;

export const retainSchema = z.object({ retain: z.boolean() });

/** One row of the candidate list: enough to judge whether to open it, and nothing more. */
export interface CandidateRow {
  id: string;
  wantedItemId: string;
  itemTitle: string;
  origin: CandidateOrigin;
  stage: CandidateStage;
  retain: boolean;
  /** Set when §7 step 2 matched an earlier candidate; v1 shows relists with the flag (§4). */
  relistOf: string | null;
  createdAt: Date;
  /** Null while the candidate is still queued or part-way through the pipeline. */
  decision: VerdictDecision | null;
  reason: RejectionReason | null;
  englishSummary: string | null;
  grade: string | null;
  listing: ListingView;
}

export interface ListingView {
  id: string;
  source: SourceId | string;
  url: string;
  title: string;
  /** The reviewer's English rendering of a Japanese title, when there is one (§1). */
  titleEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  priceGbp: string | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  buyingType: 'auction' | 'fixed' | null;
  itemLocationCountry: string | null;
  shipsToUk: ShipsToUk;
  /** Media ids of the stored, downscaled photographs, in the order the source listed them. */
  images: string[];
  listedAt: Date | null;
  endsAt: Date | null;
}

export interface CandidateList {
  rows: CandidateRow[];
  /** How many match the filter, so "showing 50 of 812" is sayable without a second request. */
  total: number;
}

/** One criterion as the verdict answered it, paired with the criterion that was asked. */
export interface CriterionEvidence {
  criterionId: string;
  /** Null for a result whose criterion is not in the spec version — it should not happen. */
  criterion: Criterion | null;
  result: CriterionResult;
  evidence: string;
}

export interface VerdictView {
  id: string;
  decision: VerdictDecision;
  reason: RejectionReason | null;
  /** Re-derived from the stored results and the spec version, never stored (see verdict.ts). */
  reasons: string[];
  criteriaResults: CriterionEvidence[];
  grade: string | null;
  englishSummary: string | null;
  modelRole: string | null;
  model: string | null;
  /** The exact text sent, so "Show prompt" is a read rather than a rebuild (§8). */
  promptText: string | null;
  promptImages: { mediaId: string; label: string; kind: string }[];
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  createdAt: Date;
}

/**
 * The detail carries its verdicts in full, so the list's flattened copy of the newest one —
 * decision, reason, summary, grade — would be a second, staler answer to the same question.
 */
export interface CandidateDetail
  extends Omit<CandidateRow, 'decision' | 'reason' | 'grade' | 'englishSummary'> {
  specVersion: number | null;
  searchPlanId: string | null;
  error: string | null;
  /** Newest first; §4 makes re-reviews append and the latest authoritative. */
  verdicts: VerdictView[];
}

export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  new: 'waiting to be reviewed',
  prefiltered: 'past the pre-filter',
  enriched: 'enriched, waiting for the reviewer',
  reviewed: 'reviewed',
  failed: 'failed',
};
