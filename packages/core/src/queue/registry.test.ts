import type { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { createSilentLogger } from '../logger.js';
import {
  assertUniqueQueues,
  DuplicateQueueError,
  type QueueRegistration,
  registerQueues,
} from './registry.js';

const registration = (name: string): QueueRegistration => ({
  name,
  handler: async () => {},
});

describe('assertUniqueQueues', () => {
  it('accepts distinct queue names', () => {
    expect(() =>
      assertUniqueQueues([registration('poll.ebay'), registration('heartbeat.worker')]),
    ).not.toThrow();
  });

  it('names every queue registered more than once', () => {
    const duplicated = [
      registration('poll.ebay'),
      registration('poll.ebay'),
      registration('review'),
      registration('review'),
    ];

    expect(() => assertUniqueQueues(duplicated)).toThrow(DuplicateQueueError);
    expect(() => assertUniqueQueues(duplicated)).toThrow('poll.ebay, review');
  });
});

/** Records what a registration asked pg-boss to do, without needing a database. */
function fakeBoss() {
  const calls: string[] = [];
  return {
    calls,
    boss: {
      async createQueue(name: string) {
        calls.push(`create ${name}`);
      },
      async work(name: string) {
        calls.push(`work ${name}`);
      },
      async schedule(name: string, cron: string) {
        calls.push(`schedule ${name} ${cron}`);
      },
    } as unknown as PgBoss,
  };
}

describe('registerQueues', () => {
  it('creates, subscribes and schedules a queue that has a handler', async () => {
    const { boss, calls } = fakeBoss();

    await registerQueues(
      boss,
      [{ ...registration('rates.refresh'), schedule: { cron: '0 4 * * *' } }],
      createSilentLogger(),
    );

    expect(calls).toEqual([
      'create rates.refresh',
      'work rates.refresh',
      'schedule rates.refresh 0 4 * * *',
    ]);
  });

  /**
   * A poll must be able to send a review job before the reviewer exists (P1-12). Creating the
   * queue without subscribing lets the jobs wait for the process that will handle them, rather
   * than a placeholder handler taking each one and throwing the candidate away.
   */
  it('creates a queue with no handler without subscribing to it', async () => {
    const { boss, calls } = fakeBoss();

    await registerQueues(boss, [{ name: 'review.candidate' }], createSilentLogger());

    expect(calls).toEqual(['create review.candidate']);
  });
});
