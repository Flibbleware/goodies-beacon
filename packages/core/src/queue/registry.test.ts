import { describe, expect, it } from 'vitest';
import { assertUniqueQueues, DuplicateQueueError, type QueueRegistration } from './registry.js';

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
