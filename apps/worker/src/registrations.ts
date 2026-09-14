import {
  type Config,
  type Database,
  heartbeatRegistration,
  type Logger,
  pollSourcesFor,
  type QueueRegistration,
  ratesRefreshRegistration,
} from '@goodies-beacon/core';
import { pollRegistration } from './poll.js';

export interface WorkerDeps {
  readonly config: Config;
  readonly db: Database;
  readonly logger: Logger;
}

/**
 * The queues a worker consumes. A worker restricted with `WORKER_SOURCES` is a sources-only worker
 * — possibly on a residential connection (§6) — so it takes its poll queues and nothing else; the
 * shared queues, and the role's heartbeat, stay with the unrestricted worker.
 */
export function workerRegistrations({ config, db, logger }: WorkerDeps): QueueRegistration[] {
  const polls = pollSourcesFor(config.workerSources).map((source) =>
    pollRegistration(source, logger),
  );

  // A worker narrowed to particular sources is a satellite — it polls and nothing else, so it
  // neither reports liveness for the whole role nor refreshes rates the core already has.
  if (config.workerSources.length > 0) return polls;

  return [
    ...polls,
    heartbeatRegistration(db, 'worker', logger),
    ratesRefreshRegistration(db, logger),
  ];
}
