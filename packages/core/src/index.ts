/**
 * @goodies-beacon/core — shared vocabulary for every other package.
 *
 * P0-01 scaffold: domain schemas arrive in P1-02, database schema in P0-05.
 */
export const PACKAGE = '@goodies-beacon/core' as const;

export { ARGON2_OPTIONS, hashPassword, verifyPassword } from './auth/password.js';
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
  createSession,
  createSessionToken,
  deleteOtherSessions,
  deleteSession,
  hashSessionToken,
  type IssuedSession,
  loadSession,
  SESSION_ID_BYTES,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
} from './auth/session.js';
export {
  AuthUserExistsError,
  createAuthUser,
  findAuthUser,
  USER_ID,
  updatePassword,
} from './auth/user.js';
export {
  type AiKeys,
  BAKED_VARIABLES,
  type Config,
  ConfigError,
  LOG_LEVELS,
  type LogLevel,
  loadConfigOrExit,
  parseConfig,
  ROLES,
  type Role,
} from './config.js';
export {
  DecryptionError,
  decryptSecret,
  encryptSecret,
  isEncrypted,
  secretsEqual,
} from './crypto.js';
export {
  CONNECT_TIMEOUT_MS,
  createDb,
  createPool,
  type Database,
  PING_TIMEOUT_MS,
  pingDatabase,
} from './db/client.js';
export { MIGRATIONS_FOLDER, runMigrations } from './db/migrate.js';
export {
  type AuthSession,
  type AuthUser,
  authSession,
  authUser,
  type Candidate,
  type CostLedgerEntry,
  candidates,
  costLedger,
  type Feedback,
  feedback,
  type GradingScale,
  gradingScales,
  type InstanceSecret,
  instanceSecret,
  type Listing,
  listings,
  type Media,
  media,
  type NewCandidate,
  type NewListing,
  type NewMedia,
  type NewSpecVersion,
  type NewVerdict,
  type NewWantedItem,
  type Notification,
  notifications,
  type ProcessHeartbeat,
  processHeartbeat,
  type SearchPlanState,
  type Seen,
  type SettingsRow,
  type SpecVersion,
  searchPlanState,
  seen,
  settings,
  specVersions,
  type Verdict,
  verdicts,
  type WantedItem,
  wantedItems,
} from './db/schema.js';
export {
  AI_ROLES,
  type AiRole,
  BACKFILL_DEPTHS,
  type BackfillDepth,
  BUYING_TYPES,
  type BuyingType,
  CANDIDATE_ORIGINS,
  CANDIDATE_STAGES,
  type CandidateOrigin,
  type CandidateStage,
  CONDITION_CATEGORIES,
  type ConditionCategory,
  CRITERION_KINDS,
  CRITERION_RESULTS,
  type CriterionKind,
  type CriterionResult,
  FEEDBACK_RESOLUTIONS,
  FEEDBACK_TYPES,
  type FeedbackResolution,
  type FeedbackType,
  MEDIA_KINDS,
  type MediaKind,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_MODES,
  type NotificationChannel,
  type NotificationMode,
  ON_UNKNOWN,
  type OnUnknown,
  REJECTION_REASONS,
  RELIST_POLICIES,
  type RejectionReason,
  type RelistPolicy,
  SHIPS_TO_UK,
  SHIPS_TO_UK_POLICIES,
  type ShipsToUk,
  type ShipsToUkPolicy,
  SPEC_ORIGINS,
  type SpecOrigin,
  VERDICT_DECISIONS,
  type VerdictDecision,
  WANTED_ITEM_STATUSES,
  type WantedItemStatus,
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
  loadSellerSalt,
  SELLER_SALT_BYTES,
  sellerHash,
  sellerHashesEqual,
} from './domain/seller.js';
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
export { createLogger, createSilentLogger, type Logger } from './logger.js';
export { createBoss, QUEUE_SCHEMA } from './queue/boss.js';
export {
  HEARTBEAT_CRON,
  HEARTBEAT_STALE_AFTER_MS,
  heartbeatRegistration,
  recordHeartbeat,
} from './queue/heartbeat.js';
export {
  HEARTBEAT_ROLES,
  type HeartbeatRole,
  heartbeatQueueName,
  heartbeatRolesFor,
  pollQueueName,
  pollSourcesFor,
} from './queue/names.js';
export {
  assertUniqueQueues,
  DuplicateQueueError,
  type JobHandler,
  type QueueRegistration,
  registerQueues,
} from './queue/registry.js';
export {
  DEFAULT_DIGEST_TIME,
  DEFAULT_SMTP_PORT,
  DEFAULT_TIMEZONE,
  type EmailSettings,
  emailSettingsSchema,
  instanceSettingsSchema,
  isEmailConfigured,
  type PublicSettings,
  type Settings,
  type SettingsPatch,
  SMTP_SECURITIES,
  type SmtpSecurity,
  settingsPatchSchema,
  settingsSchema,
  toPublicSettings,
} from './settings/schema.js';
export {
  readSettings,
  resolveSmtp,
  type SmtpCredentials,
  writeSettings,
} from './settings/store.js';
export { createShutdown, SHUTDOWN_TIMEOUT_MS, type Shutdown } from './shutdown.js';
export { isSourceId, SOURCE_IDS, type SourceId } from './sources.js';
