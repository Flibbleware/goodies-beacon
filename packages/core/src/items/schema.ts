import { z } from 'zod';
import type {
  ItemCategory,
  NotificationMode,
  SpecOrigin,
  WantedItemStatus,
} from '../domain/constants.js';
import { ITEM_CATEGORIES, WANTED_ITEM_STATUSES } from '../domain/constants.js';
import { wantedSpecSchema } from '../domain/spec.js';
import type { SourceId } from '../sources.js';

/**
 * What the manual spec editor sends (P1-13). The spec itself is `wantedSpecSchema`, unchanged —
 * the page is a JSON editor over exactly the shape §4 describes, so what is pasted in and what is
 * stored are the same document.
 */

export const itemSaveSchema = z.object({
  title: z.string().trim().min(1, 'a wanted item needs a title').max(200, 'is too long'),
  status: z.enum(WANTED_ITEM_STATUSES).default('draft'),
  /** For the list only (P1-20); defaulted so a client that predates it still saves. */
  category: z.enum(ITEM_CATEGORIES).default('other'),
  spec: wantedSpecSchema,
  /**
   * The page's own change-note field, kept out of the JSON so a note can be written without
   * editing the document. Left empty it does not override the `changeNote` the spec carries,
   * which is what lets an example spec be pasted in whole and keep the note it came with.
   */
  changeNote: z.string().nullable().default(null),
});

export type ItemSaveInput = z.infer<typeof itemSaveSchema>;

/**
 * Pause and resume (P1-14), which is not a spec change and must not write a version.
 *
 * Status says whether the instance is looking, and nothing about what it is looking for. Folding
 * it into a save would put a version in the history every time a query was paused for an evening,
 * and the history is meant to answer "what changed about the spec", not "what was I doing".
 */
export const itemStatusSchema = z.object({ status: z.enum(WANTED_ITEM_STATUSES) });

export type ItemStatusInput = z.infer<typeof itemStatusSchema>;

/** One row of the version history: enough to say what changed and when, and nothing more. */
export interface SpecVersionSummary {
  id: string;
  version: number;
  createdBy: SpecOrigin;
  summary: string;
  changeNote: string | null;
  createdAt: Date;
}

export interface CandidateCounts {
  candidates: number;
  matched: number;
  uncertain: number;
  rejected: number;
  /** Found but not yet judged: queued, part-way through the pipeline, or failed. */
  pending: number;
}

export const NO_CANDIDATES: CandidateCounts = {
  candidates: 0,
  matched: 0,
  uncertain: 0,
  rejected: 0,
  pending: 0,
};

export interface PollState {
  lastPollAt: Date | null;
  lastSuccessAt: Date | null;
  /** Plans whose last run failed. A count rather than a flag, because the page names them. */
  failingPlans: number;
}

export const NEVER_POLLED: PollState = {
  lastPollAt: null,
  lastSuccessAt: null,
  failingPlans: 0,
};

/** One row of the item page's search-plan table: the query as written, and what it has done. */
export interface PlanStats {
  planId: string;
  source: SourceId | string;
  query: string;
  region: string;
  enabled: boolean;
  /**
   * False for a plan that has state but is no longer in the current spec. Its stats are kept and
   * shown greyed rather than deleted: the candidates it found are still here, and a query that
   * was removed for finding nothing is worth being able to see was removed.
   */
  inSpec: boolean;
  watermark: Date | null;
  /** Not null while a capped run's skipped window is still being drained (§6). */
  backlogUntil: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  candidatesFound: number;
  candidatesReviewed: number;
  candidatesMatched: number;
  candidatesUncertain: number;
  prefilterCostUsd: string;
}

/**
 * The same three questions `pollStates` answers in SQL for the list, answered from plan rows
 * already in hand for one item's page. Kept beside the shapes so the two definitions of "failing"
 * sit together, and `store.integration.test.ts` asserts the list and the page agree.
 */
export function summarisePollState(plans: readonly PlanStats[]): PollState {
  let lastPollAt: Date | null = null;
  let lastSuccessAt: Date | null = null;
  let failingPlans = 0;

  for (const plan of plans) {
    if (plan.lastRunAt && (!lastPollAt || plan.lastRunAt > lastPollAt)) lastPollAt = plan.lastRunAt;
    if (plan.lastSuccessAt && (!lastSuccessAt || plan.lastSuccessAt > lastSuccessAt)) {
      lastSuccessAt = plan.lastSuccessAt;
    }
    if (plan.lastError !== null) failingPlans += 1;
  }

  return { lastPollAt, lastSuccessAt, failingPlans };
}

/** One row of the list page (§14): status, mode, last poll and counts. */
export interface ItemSummary extends PollState {
  id: string;
  title: string;
  status: WantedItemStatus;
  category: ItemCategory;
  notificationMode: NotificationMode;
  currentVersion: number | null;
  updatedAt: Date;
  counts: CandidateCounts;
}
