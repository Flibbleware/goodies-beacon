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
  type Settings,
  settings,
} from './db/schema.js';
export { isSourceId, SOURCE_IDS, type SourceId } from './sources.js';
