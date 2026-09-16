import { z } from 'zod';
import type { NotificationMode, SpecOrigin, WantedItemStatus } from '../domain/constants.js';
import { WANTED_ITEM_STATUSES } from '../domain/constants.js';
import { wantedSpecSchema } from '../domain/spec.js';

/**
 * What the manual spec editor sends (P1-13). The spec itself is `wantedSpecSchema`, unchanged —
 * the page is a JSON editor over exactly the shape §4 describes, so what is pasted in and what is
 * stored are the same document.
 */

export const itemSaveSchema = z.object({
  title: z.string().trim().min(1, 'a wanted item needs a title').max(200, 'is too long'),
  status: z.enum(WANTED_ITEM_STATUSES).default('draft'),
  spec: wantedSpecSchema,
  /**
   * The page's own change-note field, kept out of the JSON so a note can be written without
   * editing the document. Left empty it does not override the `changeNote` the spec carries,
   * which is what lets an example spec be pasted in whole and keep the note it came with.
   */
  changeNote: z.string().nullable().default(null),
});

export type ItemSaveInput = z.infer<typeof itemSaveSchema>;

/** One row of the version history: enough to say what changed and when, and nothing more. */
export interface SpecVersionSummary {
  id: string;
  version: number;
  createdBy: SpecOrigin;
  summary: string;
  changeNote: string | null;
  createdAt: Date;
}

/** An item as the list shows it, until P1-14 gives it poll counts. */
export interface ItemSummary {
  id: string;
  title: string;
  status: WantedItemStatus;
  notificationMode: NotificationMode;
  currentVersion: number | null;
  updatedAt: Date;
}
