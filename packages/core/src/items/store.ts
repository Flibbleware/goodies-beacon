import { desc, eq, max } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { gradingScales, specVersions, wantedItems } from '../db/schema.js';
import type { ItemSaveInput, ItemSummary, SpecVersionSummary } from './schema.js';

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

export interface LoadedItem {
  id: string;
  title: string;
  status: ItemSummary['status'];
  notificationMode: ItemSummary['notificationMode'];
  pollEvery: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Null only for an item whose first version failed to write, which nothing here can produce. */
  current: StoredSpec | null;
  versions: SpecVersionSummary[];
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
  const rows = await db
    .select({
      id: wantedItems.id,
      title: wantedItems.title,
      status: wantedItems.status,
      notificationMode: wantedItems.notificationMode,
      currentVersion: specVersions.version,
      updatedAt: wantedItems.updatedAt,
    })
    .from(wantedItems)
    .leftJoin(specVersions, eq(specVersions.id, wantedItems.currentSpecVersionId))
    .orderBy(desc(wantedItems.updatedAt));

  return rows.map((row) => ({ ...row, currentVersion: row.currentVersion ?? null }));
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

  return {
    id: item.id,
    title: item.title,
    status: item.status,
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
  };
}

/** A new item and its version 1, in one transaction so neither can exist without the other. */
export async function createItem(db: Database, input: ItemSaveInput): Promise<SavedVersion> {
  await assertGradingScale(db, input.spec.settings.gradingScaleId);

  return db.transaction(async (tx) => {
    const [item] = await tx
      .insert(wantedItems)
      .values(itemColumns(input))
      .returning({ id: wantedItems.id });
    if (!item) throw new Error('the wanted item was not inserted');

    return writeVersion(tx, item.id, 1, input);
  });
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

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

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
