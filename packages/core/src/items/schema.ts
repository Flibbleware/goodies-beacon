import { z } from 'zod';
import { categoryIdSchema } from '../categories/schema.js';
import type { NotificationMode, SpecOrigin, WantedItemStatus } from '../domain/constants.js';
import { WANTED_ITEM_STATUSES } from '../domain/constants.js';
import { wantedSpecSchema } from '../domain/spec.js';
import type { SourceId } from '../sources.js';

/**
 * What the manual spec editor sends (P1-13). The spec itself is `wantedSpecSchema`, unchanged —
 * the page is a JSON editor over exactly the shape §4 describes, so what is pasted in and what is
 * stored are the same document.
 */

const titleSchema = z.string().trim().min(1, 'a wanted item needs a title').max(200, 'is too long');

export const itemSaveSchema = z.object({
  title: titleSchema,
  status: z.enum(WANTED_ITEM_STATUSES).default('draft'),
  /** For the list only (P1-20, P1-22); none when left out. */
  categoryId: categoryIdSchema,
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
 * A change to the item that is not a change to its spec, and so writes no version (P1-14, P1-25).
 *
 * Status says whether the instance is looking; the title, category and display image say how the
 * owner files and recognises the thing. None of them is read by a search or a review, and the
 * history is meant to answer "what changed about what it looks for", which a version per rename
 * or per paused evening would bury. Each field is optional and a missing one is left alone — which
 * is why `categoryId` is declared here rather than borrowed, since the save's defaults to null.
 * Strict, so a spec sent here is refused rather than silently not saved.
 */
export const itemPatchSchema = z
  .strictObject({
    title: titleSchema.optional(),
    status: z.enum(WANTED_ITEM_STATUSES).optional(),
    categoryId: z.uuid('names no category').nullable().optional(),
    displayImageId: z.uuid('names no image').nullable().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'names nothing to change',
  });

export type ItemPatchInput = z.infer<typeof itemPatchSchema>;

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
  categoryId: string | null;
  displayImageId: string | null;
  notificationMode: NotificationMode;
  currentVersion: number | null;
  updatedAt: Date;
  counts: CandidateCounts;
}
