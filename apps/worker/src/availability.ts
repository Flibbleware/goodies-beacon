import {
  AVAILABILITY_CRON,
  type AvailabilityOutcome,
  availabilityQueueName,
  type BrowserFactory,
  type Config,
  type Database,
  type Logger,
  type MarketplaceSourceId,
  type QueueRegistration,
  readSettings,
  runAvailabilityCheck,
  type SourceAdapter,
} from '@goodies-beacon/core';
import { createAdapterContext } from './context.js';

/**
 * The `availability.<source>` job (P1-38): every two hours, ask the source whether each match and
 * uncertain listing is still for sale. Plumbing, as the poll job is; the work is in core.
 */

export interface AvailabilityDeps {
  readonly db: Database;
  readonly config: Config;
  readonly logger: Logger;
  readonly browser: BrowserFactory | null;
}

export function availabilityRegistration(
  source: MarketplaceSourceId,
  adapter: SourceAdapter,
  deps: AvailabilityDeps,
): QueueRegistration {
  return {
    name: availabilityQueueName(source),
    queueOptions: {
      // The next run asks again in two hours, so a missed one is not worth a backlog or a retry.
      policy: 'short',
      retryLimit: 0,
      expireInSeconds: 900,
      retentionSeconds: 7 * 86_400,
    },
    schedule: { cron: AVAILABILITY_CRON },
    handler: async (jobs) => {
      for (const job of jobs) await runAvailabilityJob(source, adapter, deps, job.signal);
    },
  };
}

export async function runAvailabilityJob(
  source: MarketplaceSourceId,
  adapter: SourceAdapter,
  deps: AvailabilityDeps,
  signal?: AbortSignal,
): Promise<AvailabilityOutcome> {
  const { db, config, logger } = deps;
  const open = await createAdapterContext({
    db,
    config,
    logger,
    settings: await readSettings(db),
    source,
    adapter,
    browser: deps.browser,
    ...(signal ? { signal } : {}),
  });

  try {
    return await runAvailabilityCheck({ db, source, adapter, ctx: open.ctx, logger });
  } finally {
    await open.close();
  }
}
