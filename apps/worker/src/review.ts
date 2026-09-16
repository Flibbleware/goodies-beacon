import { runPrefilter, runReviewer, withBudgetGuard } from '@goodies-beacon/ai';
import {
  type Config,
  type Converter,
  type Database,
  isMarketplaceSourceId,
  type Logger,
  type QueueRegistration,
  REVIEW_QUEUE,
  type ReviewOutcome,
  type ReviewPorts,
  readSettings,
  resolveSmtp,
  runReview,
} from '@goodies-beacon/core';
import { sendMail } from '@goodies-beacon/email';
import type { PgBoss } from 'pg-boss';
import { type AdapterRegistry, adapterFor } from './adapters.js';
import { createAdapterContext } from './context.js';

/**
 * The `review.candidate` job (§7): one candidate through the whole pipeline.
 *
 * As with the poll, the handler is plumbing. Everything worth testing against a database is in
 * core's `runReview`, everything worth testing against a marketplace is in the adapter, and this
 * file's whole job is to hand core the three things it cannot import for itself — the model calls,
 * an adapter's `enrich`, and the mail transport.
 */

export interface ReviewJobDeps {
  readonly db: Database;
  readonly config: Config;
  readonly logger: Logger;
  readonly converter: Converter;
  readonly boss?: PgBoss | undefined;
  readonly browser?: import('@goodies-beacon/core').BrowserFactory | null;
  /** Injectable so a test can drive the template adapter. */
  readonly adapters?: AdapterRegistry;
  /** Injectable so a test can supply a fake AI provider without a key. */
  readonly ports?: Partial<ReviewPorts>;
}

export function reviewRegistration(deps: ReviewJobDeps): QueueRegistration {
  return {
    name: REVIEW_QUEUE,
    queueOptions: {
      /**
       * Three attempts with a widening gap, per P1-12. The causes worth retrying — a provider
       * having a bad minute, a marketplace timing out, a rate limit — all pass on their own, and
       * a stage that already succeeded is not repeated because the candidate records how far it
       * got.
       */
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      // A review fetches images and waits on a vision model; the ceiling is generous.
      expireInSeconds: 600,
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
  deps: ReviewJobDeps,
  data: unknown,
  signal?: AbortSignal,
): Promise<ReviewOutcome | undefined> {
  const { db, logger } = deps;
  const payload = data as { candidateId?: string } | null;

  if (!payload?.candidateId) {
    logger.warn('discarding a review job with no candidate id', { data });
    return undefined;
  }

  const { candidateId } = payload;

  /**
   * §9: reaching the monthly cap **defers** the review rather than failing it. A failed one would
   * burn its three retries against a condition no retry can fix and dead-letter a candidate that
   * was never even looked at; a deferred one runs next month, or as soon as the cap is raised.
   */
  const guarded = withBudgetGuard(
    { db, logger, converter: deps.converter },
    async (resumeAt) => {
      if (!deps.boss) {
        logger.warn('the AI budget is spent and there is no queue handle to defer with', {
          candidateId,
        });
        return;
      }
      await deps.boss.send(REVIEW_QUEUE, { candidateId }, { startAfter: resumeAt });
      logger.info('review deferred until the budget resets', {
        candidateId,
        resumeAt: resumeAt.toISOString(),
      });
    },
    async () =>
      runReview(
        {
          db,
          logger,
          converter: deps.converter,
          ports: await buildPorts(deps, signal),
          mediaDir: deps.config.mediaDir,
          host: `https://${deps.config.host}`,
          ...(signal ? { signal } : {}),
        },
        candidateId,
      ),
  );

  return guarded();
}

/**
 * The real ports: the AI package for the two model calls, an adapter for `enrich`, SMTP for the
 * email. Anything a caller passed in wins, which is how a test runs the whole pipeline with a
 * fake provider and no keys.
 */
async function buildPorts(deps: ReviewJobDeps, signal?: AbortSignal): Promise<ReviewPorts> {
  const { db, config, logger } = deps;
  const settings = await readSettings(db);
  const ai = { db, logger, secretKey: config.secretKey, env: config.ai, settings };

  const ports: ReviewPorts = {
    prefilter: async (request) =>
      runPrefilter(ai, {
        listing: request.listing,
        spec: request.spec,
        wantedItemId: request.wantedItemId,
        candidateId: request.candidateId,
        ...(signal ? { abortSignal: signal } : {}),
      }),

    review: async (request) => {
      const result = await runReviewer(ai, {
        listing: {
          ...request.listing,
          images: request.listing.images.map((image) => ({
            mediaId: image.mediaId,
            label: image.label,
            image: image.bytes,
            mediaType: image.mediaType,
          })),
        },
        spec: request.spec,
        referenceImages: request.referenceImages.map((image) => ({
          mediaId: image.mediaId,
          label: image.label,
          image: image.bytes,
          mediaType: image.mediaType,
        })),
        wantedItemId: request.wantedItemId,
        candidateId: request.candidateId,
        ...(signal ? { abortSignal: signal } : {}),
      });

      return { ...result, promptImages: result.promptImages };
    },

    enrich: async (source, listing) => {
      if (!isMarketplaceSourceId(source)) return null;

      let adapter: ReturnType<typeof adapterFor>;
      try {
        adapter = adapterFor(source, deps.adapters);
      } catch {
        // A satellite worker, or a source whose package is not installed here. The pipeline
        // reviews what the search result carried rather than failing.
        return null;
      }

      const open = await createAdapterContext({
        db,
        config,
        logger,
        settings,
        source,
        adapter,
        browser: deps.browser ?? null,
        ...(signal ? { signal } : {}),
      });

      try {
        return await adapter.enrich(listing, open.ctx);
      } finally {
        await open.close();
      }
    },

    ...smtpPort(settings, config, logger),
  };

  return { ...ports, ...deps.ports };
}

/** The mail transport, when one is configured. An instance without SMTP simply sends nothing. */
function smtpPort(
  settings: Awaited<ReturnType<typeof readSettings>>,
  config: Config,
  logger: Logger,
): Pick<ReviewPorts, 'sendEmail'> {
  const smtp = resolveSmtp(settings, config.secretKey);
  if (!smtp) {
    logger.debug('no SMTP configured; matches will be visible in the UI only');
    return {};
  }

  return {
    sendEmail: async (message) => {
      await sendMail(smtp, { ...message, to: smtp.notificationAddress });
    },
  };
}
