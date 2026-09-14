import type { Database } from '../db/client.js';
import type { Logger } from '../logger.js';
import type { QueueRegistration } from '../queue/registry.js';
import type { Converter } from './convert.js';
import { refreshRates } from './rates.js';

export const RATES_QUEUE = 'rates.refresh';

/**
 * Just after the ECB's usual publication time in London, and again in the evening in case the
 * first attempt met a network that was down. Both are no-ops once the day's rates are stored.
 */
export const RATES_CRON = '20 16,21 * * *';

export function ratesRefreshRegistration(
  db: Database,
  logger: Logger,
  converter?: Converter,
): QueueRegistration {
  return {
    name: RATES_QUEUE,
    queueOptions: {
      // One refresh is as good as another, and a backlog of them would be pointless.
      policy: 'short',
      retryLimit: 2,
      retryDelay: 300,
      expireInSeconds: 120,
      retentionSeconds: 86_400,
    },
    schedule: { cron: RATES_CRON },
    handler: async () => {
      await refreshRates(db, logger);
      // The converter caches the newest rate per currency; without this a worker that has been
      // up all day keeps yesterday's until its own cache expires.
      converter?.invalidate();
    },
  };
}
