import {
  type BrowserFactory,
  type Config,
  createConverter,
  type Database,
  heartbeatRegistration,
  type Logger,
  type MarketplaceSourceId,
  pollSourcesFor,
  type QueueRegistration,
  REVIEW_QUEUE,
  ratesRefreshRegistration,
  readSettings,
  reconcileRegistration,
} from '@goodies-beacon/core';
import type { PgBoss } from 'pg-boss';
import { adapters } from './adapters.js';
import { pollRegistration } from './poll.js';

export interface WorkerDeps {
  readonly config: Config;
  readonly db: Database;
  readonly logger: Logger;
  /** Needed to send review jobs and to install the poll schedules (§6). */
  readonly boss?: PgBoss;
  readonly browser?: BrowserFactory | null;
}

/**
 * The queues a worker consumes. A worker restricted with `WORKER_SOURCES` is a sources-only worker
 * — possibly on a residential connection (§6) — so it takes its poll queues and nothing else; the
 * shared queues, and the role's heartbeat, stay with the unrestricted worker.
 */
export function workerRegistrations(deps: WorkerDeps): QueueRegistration[] {
  const { config, db, logger, boss } = deps;
  const converter = createConverter(db, logger);

  const polls = pollSourcesFor(config.workerSources).map((source) =>
    pollRegistration(source, {
      db,
      config,
      logger,
      converter,
      browser: deps.browser ?? null,
      enqueueReview: enqueueReview(boss, logger),
    }),
  );

  // A worker narrowed to particular sources is a satellite — it polls and nothing else, so it
  // neither reports liveness for the whole role nor refreshes rates the core already has.
  if (config.workerSources.length > 0) return polls;

  return [
    ...polls,
    heartbeatRegistration(db, 'worker', logger),
    ratesRefreshRegistration(db, logger, converter),
    /**
     * Created, not consumed: a poll must be able to send a review job before P1-12's reviewer
     * exists, and pg-boss refuses to send to a queue that was never created. The jobs wait rather
     * than being taken by a placeholder and discarded.
     */
    { name: REVIEW_QUEUE, queueOptions: { retryLimit: 3, retryDelay: 60, retryBackoff: true } },
    ...scheduleRegistrations(deps),
  ];
}

/**
 * The schedule reconciler, which only the core worker runs: schedules live centrally in pg-boss
 * and a satellite consumes the jobs they create rather than installing them.
 */
function scheduleRegistrations(deps: WorkerDeps): QueueRegistration[] {
  const { db, logger, boss } = deps;
  if (!boss) {
    logger.warn('poll schedules will not be installed: no queue handle was supplied');
    return [];
  }

  return [
    reconcileRegistration({
      db,
      boss,
      logger,
      defaultInterval: async () => (await readSettings(db)).polling.defaultInterval,
      minimumInterval: (source: MarketplaceSourceId) => adapters[source]?.recommendedMinInterval,
    }),
  ];
}

/**
 * Enqueues a review job (§3). Without a queue handle the poll still stores its candidates and says
 * loudly that nothing will look at them, which is a better failure than losing them silently.
 */
function enqueueReview(boss: PgBoss | undefined, logger: Logger) {
  return async (candidateId: string): Promise<void> => {
    if (!boss) {
      logger.warn('candidate stored but not queued for review: no queue handle', { candidateId });
      return;
    }
    await boss.send(REVIEW_QUEUE, { candidateId });
  };
}
