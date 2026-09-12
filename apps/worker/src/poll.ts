import {
  type Logger,
  pollQueueName,
  type QueueRegistration,
  type SourceId,
} from '@goodies-beacon/core';

/**
 * The queue exists from Phase 0 so the schema, the role split and `WORKER_SOURCES` can be proved
 * before any marketplace is implemented. P1-07 replaces the handler with the real poll.
 */
export function pollRegistration(source: SourceId, logger: Logger): QueueRegistration {
  return {
    name: pollQueueName(source),
    handler: async (jobs) => {
      logger.warn('poll job discarded: no source adapter yet', { source, jobs: jobs.length });
    },
  };
}
