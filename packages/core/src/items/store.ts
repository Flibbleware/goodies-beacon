import { desc, eq, max } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { gradingScales, specVersions, wantedItems } from '../db/schema.js';
import type { WantedItemStatus } from '../domain/constants.js';
import type {
  CandidateCounts,
  ItemSaveInput,
  ItemSummary,
  PlanStats,
  PollState,
  SpecVersionSummary,
} from './schema.js';
import { NEVER_POLLED, NO_CANDIDATES, summarisePollState } from './schema.js';
import { candidateCounts, planStats, pollStates } from './stats.js';

/**
 * Reading and writing wanted items and their spec versions (P1-13).
 *
 * A spec version is immutable (§4), so there is no update: every save inserts version N+1 and
 * points the item at it. The editor therefore cannot lose the version a verdict was judged under,
 * which is the whole reason "why did it reject this in July" stays answerable.
 */

/** The spec exactly as it was stored, not re-parsed: an editor must show what is on disk. */
export interface StoredSpec {
  versionId: string;
  version: number;
  document: Record<string, unknown>;
}

export interface LoadedItem extends PollState {
  id: string;
  title: string;
  status: ItemSummary['status'];
  category: ItemSummary['category'];
  notificationMode: ItemSummary['notificationMode'];
  pollEvery: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Null only for an item whose first version failed to write, which nothing here can produce. */
  current: StoredSpec | null;
  versions: SpecVersionSummary[];
  /** Every plan in the current spec with what it has done, plus any the spec has since dropped. */
  plans: PlanStats[];
  counts: CandidateCounts;
}

export interface SavedVersion {
  itemId: string;
  versionId: string;
  version: number;
}

export class UnknownGradingScaleError extends Error {
  override readonly name = 'UnknownGradingScaleError';
  constructor(readonly gradingScaleId: string) {
    super(`No grading scale with id ${gradingScaleId}.`);
  }
}

export async function listItems(db: Database): Promise<ItemSummary[]> {
  const [rows, counts, polls] = await Promise.all([
    db
      .select({
        id: wantedItems.id,
        title: wantedItems.title,
        status: wantedItems.status,
        category: wantedItems.category,
        notificationMode: wantedItems.notificationMode,
        currentVersion: specVersions.version,
        updatedAt: wantedItems.updatedAt,
      })
      .from(wantedItems)
      .leftJoin(specVersions, eq(specVersions.id, wantedItems.currentSpecVersionId))
      .orderBy(desc(wantedItems.updatedAt)),
    candidateCounts(db),
    pollStates(db),
  ]);

  return rows.map((row) => ({
    ...row,
    currentVersion: row.currentVersion ?? null,
    ...(polls.get(row.id) ?? NEVER_POLLED),
    counts: counts.get(row.id) ?? NO_CANDIDATES,
  }));
}

/**
 * Pause and resume, and nothing else (§14). Undefined when there is no such item.
 *
 * Deliberately not `saveItem` with a different status: that writes a spec version, and pausing an
 * item for a fortnight is not a change to what it is looking for. The scheduler notices within the
 * minute either way — `schedules.reconcile` reads the status rather than being told (§6).
 */
export async function setItemStatus(
  db: Database,
  id: string,
  status: WantedItemStatus,
): Promise<WantedItemStatus | undefined> {
  const [row] = await db
    .update(wantedItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(wantedItems.id, id))
    .returning({ status: wantedItems.status });

  return row?.status;
}

export async function loadItem(db: Database, id: string): Promise<LoadedItem | undefined> {
  const [item] = await db.select().from(wantedItems).where(eq(wantedItems.id, id)).limit(1);
  if (!item) return undefined;

  const versions = await db
    .select({
      id: specVersions.id,
      version: specVersions.version,
      createdBy: specVersions.createdBy,
      summary: specVersions.summary,
      plausibilityNote: specVersions.plausibilityNote,
      settings: specVersions.settings,
      criteria: specVersions.criteria,
      searchPlans: specVersions.searchPlans,
      referenceImages: specVersions.referenceImages,
      changeNote: specVersions.changeNote,
      createdAt: specVersions.createdAt,
    })
    .from(specVersions)
    .where(eq(specVersions.wantedItemId, id))
    .orderBy(desc(specVersions.version));

  const currentRow = versions.find((row) => row.id === item.currentSpecVersionId);

  const [plans, counts] = await Promise.all([
    planStats(db, id, currentRow?.searchPlans ?? []),
    candidateCounts(db, id),
  ]);

  return {
    id: item.id,
    title: item.title,
    status: item.status,
    category: item.category,
    notificationMode: item.notificationMode,
    pollEvery: item.pollEvery,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    current: currentRow
      ? {
          versionId: currentRow.id,
          version: currentRow.version,
          document: {
            summary: currentRow.summary,
            plausibilityNote: currentRow.plausibilityNote,
            settings: currentRow.settings,
            criteria: currentRow.criteria,
            searchPlans: currentRow.searchPlans,
            referenceImages: currentRow.referenceImages,
            createdBy: currentRow.createdBy,
            changeNote: currentRow.changeNote,
          },
        }
      : null,
    versions: versions.map((row) => ({
      id: row.id,
      version: row.version,
      createdBy: row.createdBy,
      summary: row.summary,
      changeNote: row.changeNote,
      createdAt: row.createdAt,
    })),
    plans,
    counts: counts.get(id) ?? NO_CANDIDATES,
    ...summarisePollState(plans),
  };
}

/** A new item and its version 1, in one transaction so neither can exist without the other. */
export async function createItem(db: Database, input: ItemSaveInput): Promise<SavedVersion> {
  await assertGradingScale(db, input.spec.settings.gradingScaleId);

  return db.transaction((tx) => insertItem(tx, input));
}

/**
 * `createItem` inside a transaction someone else holds, for a caller that must do something else
 * atomically with it — promoting a wish deletes the wish in the same one (P1-19). It does not
 * check the grading scale; a caller whose spec can name one must.
 */
export async function insertItem(tx: Transaction, input: ItemSaveInput): Promise<SavedVersion> {
  const [item] = await tx
    .insert(wantedItems)
    .values(itemColumns(input))
    .returning({ id: wantedItems.id });
  if (!item) throw new Error('the wanted item was not inserted');

  return writeVersion(tx, item.id, 1, input);
}

/** Version N+1 for an existing item. Undefined when there is no such item. */
export async function saveItem(
  db: Database,
  id: string,
  input: ItemSaveInput,
): Promise<SavedVersion | undefined> {
  await assertGradingScale(db, input.spec.settings.gradingScaleId);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: wantedItems.id })
      .from(wantedItems)
      .where(eq(wantedItems.id, id))
      .limit(1);
    if (!existing) return undefined;

    const [highest] = await tx
      .select({ version: max(specVersions.version) })
      .from(specVersions)
      .where(eq(specVersions.wantedItemId, id));

    return writeVersion(tx, id, (highest?.version ?? 0) + 1, input);
  });
}

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function writeVersion(
  tx: Transaction,
  itemId: string,
  version: number,
  input: ItemSaveInput,
): Promise<SavedVersion> {
  const spec = input.spec;

  const [row] = await tx
    .insert(specVersions)
    .values({
      wantedItemId: itemId,
      version,
      // Whatever the document claims, this route is the manual editor and nothing else (§4).
      createdBy: 'manual_edit',
      summary: spec.summary,
      plausibilityNote: spec.plausibilityNote,
      settings: spec.settings as unknown as Record<string, unknown>,
      criteria: spec.criteria,
      searchPlans: spec.searchPlans,
      referenceImages: spec.referenceImages,
      changeNote: input.changeNote ?? spec.changeNote,
    })
    .returning({ id: specVersions.id });
  if (!row) throw new Error('the spec version was not inserted');

  await tx
    .update(wantedItems)
    .set({ ...itemColumns(input), currentSpecVersionId: row.id, updatedAt: new Date() })
    .where(eq(wantedItems.id, itemId));

  return { itemId, versionId: row.id, version };
}

/**
 * The four settings §4 gives both the item and its spec, projected onto the columns on save.
 *
 * They are one field in the UI and the document is the one the owner edits, so the columns follow
 * it rather than the other way about — and they have to, because the runtime reads the columns:
 * the scheduler takes `pollEvery` from the item row (§6) and the review pipeline takes
 * `notificationMode` from it (§10). Writing a spec that says `realtime` and leaving the column at
 * `digest` would give an item that agrees with itself on screen and emails nobody.
 */
function itemColumns(input: ItemSaveInput) {
  const settings = input.spec.settings;
  return {
    title: input.title,
    status: input.status,
    category: input.category,
    notificationMode: settings.notificationMode,
    pollEvery: settings.pollEvery,
    gradingScaleId: settings.gradingScaleId,
    minimumGrade: settings.minimumGrade,
  };
}

/**
 * A `gradingScaleId` naming no scale is a foreign key violation, which reaches the API as a 500
 * about a constraint nobody typed. Checked first so the editor can point at the field instead.
 */
async function assertGradingScale(db: Database, id: string | null): Promise<void> {
  if (id === null) return;

  const [scale] = await db
    .select({ id: gradingScales.id })
    .from(gradingScales)
    .where(eq(gradingScales.id, id))
    .limit(1);
  if (!scale) throw new UnknownGradingScaleError(id);
}
