import type { Config, Database, SourceId } from '@goodies-beacon/core';
import {
  assertUniqueQueues,
  createSilentLogger,
  MARKETPLACE_SOURCE_IDS,
} from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { workerRegistrations } from './registrations.js';

const logger = createSilentLogger();
const db = {} as Database;

function deps(workerSources: readonly SourceId[]) {
  return { config: { workerSources } as unknown as Config, db, logger };
}

function names(workerSources: readonly SourceId[]): string[] {
  return workerRegistrations(deps(workerSources)).map(({ name }) => name);
}

describe('workerRegistrations', () => {
  it('subscribes to every source, its heartbeat and the rate refresh when WORKER_SOURCES is empty', () => {
    expect(names([])).toEqual([
      ...MARKETPLACE_SOURCE_IDS.map((id) => `poll.${id}`),
      'heartbeat.worker',
      'rates.refresh',
    ]);
  });

  /** A narrowed worker is a satellite: it polls, and the core keeps the shared jobs. */
  it('subscribes only to the named poll queues when WORKER_SOURCES narrows it', () => {
    expect(names(['ebay'])).toEqual(['poll.ebay']);
    expect(names(['vinted', 'mercari_jp'])).toEqual(['poll.vinted', 'poll.mercari_jp']);
  });

  it('registers each queue name exactly once', () => {
    for (const sources of [[], ['ebay'], MARKETPLACE_SOURCE_IDS] as const) {
      const registrations = workerRegistrations(deps(sources));
      expect(() => assertUniqueQueues(registrations)).not.toThrow();
      expect(new Set(registrations.map(({ name }) => name)).size).toBe(registrations.length);
    }
  });
});
