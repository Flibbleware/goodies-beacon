import {
  type BackfillDepth,
  type BrowserFactory,
  type Config,
  type Converter,
  type Database,
  findActivePlan,
  isMarketplaceSourceId,
  type Logger,
  type PollJobData,
  type PollMode,
  type PollOutcome,
  pollQueueName,
  type QueueRegistration,
  readSettings,
  recordPollFailure,
  runPoll,
  type SourceId,
} from '@goodies-beacon/core';
import { type AdapterRegistry, adapterFor } from './adapters.js';
import { createAdapterContext } from './context.js';

/**
 * The `poll.<source>` job (§6): one run of one search plan.
 *
 * The handler itself is plumbing — resolve the plan, build a context, hand both to core's
 * `runPoll` — because everything worth testing against a database lives in core and everything
 * worth testing against a marketplace lives in the adapter.
 */

export interface PollDeps {
  readonly db: Database;
  readonly config: Config;
  readonly logger: Logger;
  readonly converter: Converter;
  readonly enqueueReview: (candidateId: string) => Promise<void>;
  /** Null in a process with no Chromium; an adapter that needs one then fails with a clear error. */
  readonly browser: BrowserFactory | null;
  /** Injectable so a test can poll the template adapter, which has no queue of its own. */
  readonly adapters?: AdapterRegistry;
}

interface JobPayload extends PollJobData {
  mode?: PollMode;
  depth?: BackfillDepth;
}

export function pollRegistration(source: SourceId, deps: PollDeps): QueueRegistration {
  return {
    name: pollQueueName(source),
    queueOptions: {
      /**
       * A failed poll is retried with a widening gap rather than immediately: the usual causes —
       * a marketplace having a bad minute, a rate limit, a proxy dropping — are all things that
       * fix themselves given a pause, and hammering them is what turns a blip into a block.
       */
      retryLimit: 3,
      retryDelay: 120,
      retryBackoff: true,
      // A poll of a broad query pages with jittered spacing, so the ceiling is generous.
      expireInSeconds: 900,
      retentionSeconds: 7 * 86_400,
    },
    handler: async (jobs) => {
      for (const job of jobs) {
        await runJob(deps, job.data, job.signal);
      }
    },
  };
}

export async function runJob(
  deps: PollDeps,
  data: unknown,
  signal?: AbortSignal,
): Promise<PollOutcome | undefined> {
  const { db, config, logger } = deps;
  const payload = data as JobPayload | null;

  if (!payload?.planId || !payload.wantedItemId || !isMarketplaceSourceId(payload.source ?? '')) {
    logger.warn('discarding a poll job with no usable payload', { data });
    return undefined;
  }

  const mode = payload.mode ?? 'poll';
  const plan = await findActivePlan(db, payload.wantedItemId, payload.planId, logger);

  /**
   * The plan may have been paused, deleted or had its marketplace switched off between the
   * schedule firing and the job running. That is not a failure — the reconciler will drop the
   * schedule on its next pass — so it is a debug line rather than an error, and nothing is
   * recorded against a plan that may no longer exist.
   */
  if (!plan) {
    logger.debug('poll skipped: the plan is no longer active', {
      planId: payload.planId,
      wantedItemId: payload.wantedItemId,
    });
    return undefined;
  }

  const settings = await readSettings(db);
  const cap = mode === 'poll' ? settings.polling.pollCap : settings.polling.backfillCap;

  let adapter: ReturnType<typeof adapterFor>;
  try {
    adapter = adapterFor(plan.source, deps.adapters);
  } catch (error) {
    // Recorded rather than thrown: an adapter that is not installed will not appear by retrying,
    // so the plan shows why it is not polling and the job does not churn through its retries.
    await recordPollFailure(db, plan.plan.id, error);
    logger.warn('poll skipped: no adapter', { planId: plan.plan.id, source: plan.source });
    return undefined;
  }

  const open = await createAdapterContext({
    db,
    config,
    logger,
    settings,
    source: plan.source,
    adapter,
    browser: deps.browser,
    ...(signal ? { signal } : {}),
  }).catch(async (error: unknown) => {
    await recordPollFailure(db, plan.plan.id, error);
    throw error;
  });

  try {
    return await runPoll({
      db,
      converter: deps.converter,
      logger,
      enqueueReview: deps.enqueueReview,
      adapter,
      ctx: open.ctx,
      plan,
      mode,
      cap,
      ...(payload.depth ? { depth: payload.depth } : {}),
    });
  } finally {
    await open.close();
  }
}
