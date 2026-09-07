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
export { isSourceId, SOURCE_IDS, type SourceId } from './sources.js';
