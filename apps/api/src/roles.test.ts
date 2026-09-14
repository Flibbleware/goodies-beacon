import type { Config, Database, Role } from '@goodies-beacon/core';
import {
  assertUniqueQueues,
  createSilentLogger,
  MARKETPLACE_SOURCE_IDS,
} from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { processRegistrations } from './roles.js';

const logger = createSilentLogger();
const POLL_QUEUES = MARKETPLACE_SOURCE_IDS.map((id) => `poll.${id}`);

async function names(role: Role, workerSources: string[] = []): Promise<string[]> {
  const registrations = await processRegistrations({
    config: { role, workerSources } as unknown as Config,
    db: {} as Database,
    logger,
  });
  assertUniqueQueues(registrations);
  return registrations.map(({ name }) => name);
}

describe('processRegistrations', () => {
  it('runs the api and the workers in one process for ROLE=all', async () => {
    expect(await names('all')).toEqual([
      'heartbeat.api',
      ...POLL_QUEUES,
      'heartbeat.worker',
      'rates.refresh',
    ]);
  });

  it('splits the two roles across processes that each take only their own queues', async () => {
    expect(await names('api')).toEqual(['heartbeat.api']);
    expect(await names('worker')).toEqual([...POLL_QUEUES, 'heartbeat.worker', 'rates.refresh']);
  });

  it('narrows a sources-only worker to the queues in WORKER_SOURCES', async () => {
    expect(await names('worker', ['ebay'])).toEqual(['poll.ebay']);
  });
});
