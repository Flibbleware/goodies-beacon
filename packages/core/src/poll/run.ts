import type { AdapterContext, PollMode, SearchRequest, SourceAdapter } from '../adapter/types.js';
import type { BackfillDepth } from '../domain/constants.js';
import type { SearchPlan } from '../domain/spec.js';
import type { SourceId } from '../sources.js';
import {
  ensurePlanState,
  type IngestDeps,
  type IngestResult,
  ingestListings,
  recordPollFailure,
} from './ingest.js';
/**
 * One poll, end to end: work out the window, ask the adapter, store what came back (§6).
 *
 * In core rather than in the worker so it can be run against the template adapter and a real
 * database in a test, which is what P1-07's acceptance asks for. The worker supplies the adapter
 * and its context and does nothing else.
 */

/**
 * What a poll needs to know about the plan it is running.
 *
 * Narrower than `ActivePlan` on purpose: `source` is any storable source rather than only a
 * pollable marketplace, so the template adapter — which has no queue and never appears in a
 * schedule — can be run through the whole path in a test (`sources.ts`).
 */
export interface PollTarget {
  readonly wantedItemId: string;
  readonly specVersionId: string;
  readonly plan: SearchPlan;
  readonly source: SourceId;
}

export interface RunPollOptions extends IngestDeps {
  readonly adapter: SourceAdapter;
  readonly ctx: AdapterContext;
  readonly plan: PollTarget;
  readonly mode: PollMode;
  readonly depth?: BackfillDepth;
  /** Stop after this many listings (§6). Comes from the polling settings.  */
  readonly cap: number;
}

export interface PollOutcome extends IngestResult {
  /** The window that was searched, for the log line and the per-plan stats. */
  window: { since: Date | null; until: Date | null };
  stoppedAtCap: boolean;
  /** True when this run was draining a gap left by an earlier capped run. */
  drainingBacklog: boolean;
}

export async function runPoll(options: RunPollOptions): Promise<PollOutcome> {
  const { adapter, ctx, plan, mode, cap, db, logger } = options;

  const state = await ensurePlanState(db, {
    planId: plan.plan.id,
    wantedItemId: plan.wantedItemId,
    source: plan.source,
  });

  /**
   * A backfill or a scan deliberately ignores the watermark: it is a sweep of what is listed
   * now, bounded by the cap rather than by a date (§6). A routine poll uses the backlog window
   * when there is one, so the gap an earlier capped run left is drained before anything newer is
   * looked at again.
   */
  const drainingBacklog = mode === 'poll' && state.backlogFrom !== null;
  const window =
    mode !== 'poll'
      ? { since: null, until: null }
      : drainingBacklog
        ? { since: state.backlogFrom, until: state.backlogUntil }
        : { since: state.watermark, until: null };

  const request: SearchRequest = {
    since: window.since,
    mode,
    cap,
    ...(window.until ? { until: window.until } : {}),
    ...(options.depth ? { depth: options.depth } : {}),
  };

  let found: Awaited<ReturnType<SourceAdapter['search']>>;
  try {
    found = await adapter.search(plan.plan, request, ctx);
  } catch (error) {
    // Recorded before it is rethrown, so pg-boss's retry and the dashboard see the same failure.
    await recordPollFailure(db, plan.plan.id, error);
    throw error;
  }

  /**
   * The adapter is told to stop at the cap and does not report why it stopped, so a full batch is
   * read as "there was more". A window that happens to hold exactly `cap` listings is therefore
   * treated as capped and the next run searches a gap that turns out to be empty: one wasted
   * request, against silently losing listings if the guess went the other way.
   */
  const stoppedAtCap = found.length >= cap;

  try {
    const result = await ingestListings(options, {
      wantedItemId: plan.wantedItemId,
      specVersionId: plan.specVersionId,
      planId: plan.plan.id,
      source: plan.source,
      origin: mode,
      listings: found,
      since: window.since,
      stoppedAtCap,
    });

    logger.info('poll finished', {
      planId: plan.plan.id,
      source: plan.source,
      query: plan.plan.query,
      region: plan.plan.region,
      mode,
      found: found.length,
      newCandidates: result.newCandidates,
      stoppedAtCap,
      drainingBacklog,
    });

    return { ...result, window, stoppedAtCap, drainingBacklog };
  } catch (error) {
    await recordPollFailure(db, plan.plan.id, error);
    throw error;
  }
}
