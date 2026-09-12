import type { Logger } from './logger.js';

/**
 * Longer than pg-boss's own 30-second graceful stop, so a job that uses all of its grace period
 * still finishes before the watchdog gives up on it.
 */
export const SHUTDOWN_TIMEOUT_MS = 45_000;

export interface ShutdownOptions {
  readonly logger: Logger;
  readonly timeoutMs?: number;
  readonly signals?: readonly NodeJS.Signals[];
  /** Overridden in tests; nothing else should need to. */
  readonly exit?: (code: number) => void;
}

export interface Shutdown {
  /** Steps run in reverse registration order, so a resource closes before whatever it depends on. */
  add(name: string, step: () => Promise<unknown>): void;
  /** Idempotent: a second signal joins the shutdown already in progress. */
  run(reason: string): Promise<void>;
  /** Start listening for SIGTERM and SIGINT. */
  listen(): void;
}

export function createShutdown(options: ShutdownOptions): Shutdown {
  const {
    logger,
    timeoutMs = SHUTDOWN_TIMEOUT_MS,
    signals = ['SIGTERM', 'SIGINT'],
    exit = (code) => process.exit(code),
  } = options;

  const steps: { name: string; step: () => Promise<unknown> }[] = [];
  let running: Promise<void> | undefined;

  async function drain(reason: string): Promise<void> {
    logger.info('shutting down', { reason });
    // Unreferenced so a clean shutdown is not held open by its own watchdog.
    const watchdog = setTimeout(() => {
      logger.error('shutdown timed out; exiting anyway', { timeoutMs });
      exit(1);
    }, timeoutMs).unref();

    let failed = false;
    for (const { name, step } of [...steps].reverse()) {
      try {
        await step();
        logger.debug('closed', { step: name });
      } catch (error) {
        failed = true;
        logger.error('failed to close cleanly', { step: name, error: describe(error) });
      }
    }

    clearTimeout(watchdog);
    logger.info('shutdown complete');
    exit(failed ? 1 : 0);
  }

  function run(reason: string): Promise<void> {
    running ??= drain(reason);
    return running;
  }

  return {
    add(name, step) {
      steps.push({ name, step });
    },
    run,
    listen() {
      for (const signal of signals) {
        process.once(signal, () => {
          void run(signal);
        });
      }
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
