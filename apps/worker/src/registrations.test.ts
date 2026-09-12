import type { Config, Database, Logger, SourceId } from '@goodies-beacon/core';
import { assertUniqueQueues, SOURCE_IDS } from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { workerRegistrations } from './registrations.js';

const logger: Logger = { error() {}, warn() {}, info() {}, debug() {} };
const db = {} as Database;

function deps(workerSources: readonly SourceId[]) {
  return { config: { workerSources } as Config, db, logger };
}

function names(workerSources: readonly SourceId[]): string[] {
  return workerRegistrations(deps(workerSources)).map(({ name }) => name);
}

describe('workerRegistrations', () => {
  it('subscribes to every source plus its own heartbeat when WORKER_SOURCES is empty', () => {
    expect(names([])).toEqual([...SOURCE_IDS.map((id) => `poll.${id}`), 'heartbeat.worker']);
  });

  it('subscribes only to the named poll queues when WORKER_SOURCES narrows it', () => {
    expect(names(['ebay'])).toEqual(['poll.ebay']);
    expect(names(['vinted', 'mercari_jp'])).toEqual(['poll.vinted', 'poll.mercari_jp']);
  });

  it('registers each queue name exactly once', () => {
    for (const sources of [[], ['ebay'], SOURCE_IDS] as const) {
      const registrations = workerRegistrations(deps(sources));
      expect(() => assertUniqueQueues(registrations)).not.toThrow();
      expect(new Set(registrations.map(({ name }) => name)).size).toBe(registrations.length);
    }
  });
});
