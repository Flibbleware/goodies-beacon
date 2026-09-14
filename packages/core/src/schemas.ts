/**
 * @goodies-beacon/core/schemas — the validation the API and the web app must agree on.
 *
 * A separate entry point from the package root because the web app runs in a browser: the root
 * barrel reaches Postgres, pg-boss, pino and the native argon2 binding, none of which can be
 * bundled. Nothing imported from here may depend on those, and `schemas.test.ts` proves it.
 */
export {
  type ChangePasswordInput,
  changePasswordSchema,
  type FirstRunInput,
  firstRunSchema,
  type LoginInput,
  loginSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
} from './auth/schemas.js';
export {
  AI_ROLES,
  type AiRole,
  BACKFILL_DEPTHS,
  type BackfillDepth,
  CONDITION_CATEGORIES,
  type ConditionCategory,
  CRITERION_KINDS,
  type CriterionKind,
  IMAGE_STRATEGIES,
  type ImageStrategy,
  ON_UNKNOWN,
  type OnUnknown,
  RELIST_POLICIES,
  type RelistPolicy,
  SHIPS_TO_UK_POLICIES,
  type ShipsToUkPolicy,
} from './domain/constants.js';
export {
  LINT_CODES,
  type LintCode,
  lintCriterion,
  lintSpec,
  type SpecWarning,
} from './domain/lint.js';
export {
  type ListingImage,
  listingImageSchema,
  type NormalisedListing,
  normalisedListingSchema,
} from './domain/listing.js';
export {
  backfillSchema,
  type Criterion,
  criterionSchema,
  durationSchema,
  type PriceCeiling,
  priceCeilingSchema,
  type ReferenceImage,
  referenceImageSchema,
  type SearchPlan,
  type SpecSettings,
  searchPlanSchema,
  specSettingsSchema,
  type WantedSpec,
  wantedSpecSchema,
} from './domain/spec.js';
export {
  type CriterionResultEntry,
  criterionResultSchema,
  type PrefilterOutput,
  prefilterOutputSchema,
  type ReviewerOutput,
  reviewerOutputSchema,
  type VerdictResult,
  verdictSchema,
} from './domain/verdict.js';
export {
  AI_PROVIDERS,
  type AiProvider,
  type AiSettings,
  aiSettingsSchema,
  DEFAULT_AI_ROLES,
  DEFAULT_DIGEST_TIME,
  DEFAULT_SMTP_PORT,
  DEFAULT_TIMEZONE,
  type EbaySourceSettings,
  type EmailSettings,
  ebaySourceSchema,
  emailSettingsSchema,
  instanceSettingsSchema,
  isEbayConfigured,
  isEmailConfigured,
  modelRefSchema,
  type PublicProvider,
  type PublicSettings,
  parseModelRef,
  type Settings,
  type SettingsPatch,
  SMTP_SECURITIES,
  type SmtpSecurity,
  type SourcesSettings,
  settingsPatchSchema,
  settingsSchema,
  sourcesSettingsSchema,
  toPublicSettings,
} from './settings/schema.js';
