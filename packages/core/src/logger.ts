import { type DestinationStream, type Logger as PinoLogger, pino } from 'pino';
import type { LogLevel } from './config.js';

export interface Logger {
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  /** A logger that stamps every line with these fields — one per request, carrying its id. */
  child(fields: Record<string, unknown>): Logger;
}

/**
 * JSON lines on stdout, which is where `docker compose logs` reads them from. LOG_LEVEL is
 * pino's own vocabulary, so it is handed over unchanged. `destination` is for tests that need to
 * read back what was written.
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  // base: null drops pid and hostname, which say nothing useful about a single container.
  return wrap(pino({ level, base: null }, destination));
}

/** For tests and for anything that should not write: every call becomes a no-op. */
export function createSilentLogger(): Logger {
  const silent: Logger = {
    error() {},
    warn() {},
    info() {},
    debug() {},
    child: () => silent,
  };
  return silent;
}

/**
 * pino takes the fields first and the message second; the rest of the codebase reads better with
 * the message first, so this is the only place the two orders meet.
 */
function wrap(logger: PinoLogger): Logger {
  return {
    error: (message, fields) => logger.error(fields ?? {}, message),
    warn: (message, fields) => logger.warn(fields ?? {}, message),
    info: (message, fields) => logger.info(fields ?? {}, message),
    debug: (message, fields) => logger.debug(fields ?? {}, message),
    child: (fields) => wrap(logger.child(fields)),
  };
}
