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
  createSessionId,
  deleteOtherSessions,
  deleteSession,
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
  type ProcessHeartbeat,
  processHeartbeat,
  type SettingsRow,
  settings,
} from './db/schema.js';
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
