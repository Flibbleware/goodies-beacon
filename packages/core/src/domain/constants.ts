/**
 * The bounded value sets from ARCHITECTURE.md §4, in one place.
 *
 * They are `as const` tuples rather than Postgres enums so that the TypeScript type, the database
 * check constraint and the Zod schema in P1-02 all derive from the same declaration — adding a
 * value is one edit, and `ALTER TYPE` is never in the way of a migration.
 */

export const WANTED_ITEM_STATUSES = ['draft', 'active', 'paused', 'found', 'archived'] as const;
export type WantedItemStatus = (typeof WANTED_ITEM_STATUSES)[number];

export const NOTIFICATION_MODES = ['realtime', 'digest'] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

/** What caused a new immutable spec version (§4). */
export const SPEC_ORIGINS = [
  'interview',
  'amendment',
  'challenge',
  'manual_edit',
  'image_added',
] as const;
export type SpecOrigin = (typeof SPEC_ORIGINS)[number];

export const BUYING_TYPES = ['auction', 'fixed'] as const;
export type BuyingType = (typeof BUYING_TYPES)[number];

/** Deliberately three-valued: §1 shows the flag rather than filtering on it. */
export const SHIPS_TO_UK = ['yes', 'no', 'unknown'] as const;
export type ShipsToUk = (typeof SHIPS_TO_UK)[number];

/** Decides notification routing: only `poll` reaches a real-time email (§10). */
export const CANDIDATE_ORIGINS = ['poll', 'backfill', 'scan'] as const;
export type CandidateOrigin = (typeof CANDIDATE_ORIGINS)[number];

/**
 * How far through the pipeline (§7) a candidate has travelled. `failed` is terminal until a
 * retry succeeds and is what P1-12 surfaces in the UI rather than losing in a log.
 */
export const CANDIDATE_STAGES = ['new', 'prefiltered', 'enriched', 'reviewed', 'failed'] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export const VERDICT_DECISIONS = ['match', 'uncertain', 'reject'] as const;
export type VerdictDecision = (typeof VERDICT_DECISIONS)[number];

/** Per-criterion outcome inside a verdict's `criteria_results` (§7 step 5). */
export const CRITERION_RESULTS = ['pass', 'fail', 'unknown'] as const;
export type CriterionResult = (typeof CRITERION_RESULTS)[number];

/**
 * Why a candidate was rejected without reaching the vision model, so the audit view can say so
 * (§7 step 2). `null` on a verdict means the reviewer decided it.
 */
export const REJECTION_REASONS = ['over_budget', 'negative_keyword', 'prefilter'] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const FEEDBACK_TYPES = ['not_a_match', 'challenge'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_RESOLUTIONS = ['rereviewed', 'folded_into_spec', 'dismissed'] as const;
export type FeedbackResolution = (typeof FEEDBACK_RESOLUTIONS)[number];

/** At most one Notification per candidate per channel (§10), enforced by a unique index. */
export const NOTIFICATION_CHANNELS = ['realtime', 'digest'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const MEDIA_KINDS = ['listing', 'reference', 'grade_example'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * The three configurable model roles (§9). Declared here rather than in `packages/ai` because
 * `cost_ledger` constrains a column to them and core cannot depend on the AI package; P1-08
 * should have `packages/ai` import these rather than declare its own.
 */
export const AI_ROLES = ['interviewer', 'prefilter', 'reviewer'] as const;
export type AiRole = (typeof AI_ROLES)[number];
