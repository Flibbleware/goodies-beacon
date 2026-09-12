/**
 * @goodies-beacon/core — shared vocabulary for every other package.
 *
 * P0-01 scaffold: domain schemas arrive in P1-02, database schema in P0-05.
 */
export const PACKAGE = '@goodies-beacon/core' as const;

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
export { createDb, createPool, type Database } from './db/client.js';
export { MIGRATIONS_FOLDER, runMigrations } from './db/migrate.js';
export {
  type AuthSession,
  type AuthUser,
  authSession,
  authUser,
  type ProcessHeartbeat,
  processHeartbeat,
  type Settings,
  settings,
} from './db/schema.js';
export { createConsoleLogger, type Logger } from './logger.js';
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
export { createShutdown, SHUTDOWN_TIMEOUT_MS, type Shutdown } from './shutdown.js';
export { isSourceId, SOURCE_IDS, type SourceId } from './sources.js';
