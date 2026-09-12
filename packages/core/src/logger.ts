import type { LogLevel } from './config.js';

export interface Logger {
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}

/** pino's numbers, so LOG_LEVEL means the same thing here as it will once pino replaces this. */
const SEVERITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
};

/**
 * Enough of a logger for the process lifecycle to be legible before P0-08 brings pino in behind
 * this interface.
 */
export function createConsoleLogger(level: LogLevel): Logger {
  const threshold = SEVERITY[level];
  const at = (
    name: Exclude<LogLevel, 'silent' | 'fatal'>,
    write: (line: string) => void,
  ): Logger['info'] => {
    if (SEVERITY[name] < threshold) return () => {};
    return (message, fields) => {
      write(fields ? `${name}: ${message} ${JSON.stringify(fields)}` : `${name}: ${message}`);
    };
  };

  return {
    error: at('error', console.error),
    warn: at('warn', console.warn),
    info: at('info', console.log),
    debug: at('debug', console.log),
  };
}
