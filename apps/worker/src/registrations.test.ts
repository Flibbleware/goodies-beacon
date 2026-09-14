import type { Config, Database, SourceId } from '@goodies-beacon/core';
import {
  assertUniqueQueues,
  createSilentLogger,
  MARKETPLACE_SOURCE_IDS,
  REVIEW_QUEUE,
  SCHEDULE_QUEUE,
} from '@goodies-beacon/core';
import type { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { workerRegistrations } from './registrations.js';

const logger = createSilentLogger();
const db = {} as Database;
const boss = {} as PgBoss;

function deps(workerSources: readonly SourceId[]) {
  return { config: { workerSources } as unknown as Config, db, logger, boss };
}

function names(workerSources: readonly SourceId[]): string[] {
  return workerRegistrations(deps(workerSources)).map(({ name }) => name);
}

describe('workerRegistrations', () => {
  it('subscribes to every source and the shared queues when WORKER_SOURCES is empty', () => {
    expect(names([])).toEqual([
      ...MARKETPLACE_SOURCE_IDS.map((id) => `poll.${id}`),
      'heartbeat.worker',
      'rates.refresh',
      REVIEW_QUEUE,
      SCHEDULE_QUEUE,
    ]);
  });

  /** A narrowed worker is a satellite: it polls, and the core keeps the shared jobs. */
  it('subscribes only to the named poll queues when WORKER_SOURCES narrows it', () => {
    expect(names(['ebay'])).toEqual(['poll.ebay']);
    expect(names(['vinted', 'mercari_jp'])).toEqual(['poll.vinted', 'poll.mercari_jp']);
  });

  /**
   * The review queue has to exist before P1-12's reviewer does, or a poll cannot send to it — but
   * a placeholder handler would take each job and throw the candidate away, so it has none.
   */
  it('creates the review queue without consuming it', () => {
    const review = workerRegistrations(deps([])).find(({ name }) => name === REVIEW_QUEUE);

    expect(review).toBeDefined();
    expect(review?.handler).toBeUndefined();
  });

  it('installs the reconciler on a schedule so a paused item stops polling without a restart', () => {
    const reconcile = workerRegistrations(deps([])).find(({ name }) => name === SCHEDULE_QUEUE);

    expect(reconcile?.schedule?.cron).toBe('* * * * *');
    expect(reconcile?.handler).toBeDefined();
  });

  /** Without a queue handle nothing can be scheduled; the poll queues still register. */
  it('leaves the reconciler out, loudly, when there is no queue handle', () => {
    const registrations = workerRegistrations({
      config: { workerSources: [] } as unknown as Config,
      db,
      logger,
    });

    expect(registrations.map(({ name }) => name)).not.toContain(SCHEDULE_QUEUE);
  });

  it('registers each queue name exactly once', () => {
    for (const sources of [[], ['ebay'], MARKETPLACE_SOURCE_IDS] as const) {
      const registrations = workerRegistrations(deps(sources));
      expect(() => assertUniqueQueues(registrations)).not.toThrow();
      expect(new Set(registrations.map(({ name }) => name)).size).toBe(registrations.length);
    }
  });
});
