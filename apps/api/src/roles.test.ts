import type { Config, Database, Role } from '@goodies-beacon/core';
import {
  assertUniqueQueues,
  createSilentLogger,
  MARKETPLACE_SOURCE_IDS,
  REVIEW_QUEUE,
  SCHEDULE_QUEUE,
} from '@goodies-beacon/core';
import type { WorkerDeps } from '@goodies-beacon/worker';
import { describe, expect, it } from 'vitest';
import { processRegistrations } from './roles.js';

const logger = createSilentLogger();
const POLL_QUEUES = MARKETPLACE_SOURCE_IDS.map((id) => `poll.${id}`);
/** The shared queues an unrestricted worker keeps, in the order it registers them. */
const SHARED_QUEUES = ['heartbeat.worker', 'rates.refresh', REVIEW_QUEUE, SCHEDULE_QUEUE];

async function names(role: Role, workerSources: string[] = []): Promise<string[]> {
  const registrations = await processRegistrations({
    config: { role, workerSources } as unknown as Config,
    db: {} as Database,
    logger,
    // Only its presence matters here: without a queue handle the reconciler is left out.
    boss: {} as NonNullable<WorkerDeps['boss']>,
  });
  assertUniqueQueues(registrations);
  return registrations.map(({ name }) => name);
}

describe('processRegistrations', () => {
  it('runs the api and the workers in one process for ROLE=all', async () => {
    expect(await names('all')).toEqual(['heartbeat.api', ...POLL_QUEUES, ...SHARED_QUEUES]);
  });

  it('splits the two roles across processes that each take only their own queues', async () => {
    expect(await names('api')).toEqual(['heartbeat.api']);
    expect(await names('worker')).toEqual([...POLL_QUEUES, ...SHARED_QUEUES]);
  });

  it('narrows a sources-only worker to the queues in WORKER_SOURCES', async () => {
    expect(await names('worker', ['ebay'])).toEqual(['poll.ebay']);
  });
});
