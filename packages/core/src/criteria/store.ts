import { isDeepStrictEqual } from 'node:util';
import { asc, eq, inArray, max, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sharedCriteria, specVersions, wantedItems } from '../db/schema.js';
import {
  lockedFields,
  type SharedCriterion,
  type SharedCriterionCreateInput,
  type SharedCriterionFields,
  type SharedCriterionUpdateInput,
} from '../domain/shared-criterion.js';
import type { WantedSpec } from '../domain/spec.js';

/**
 * Reading and writing shared criteria (P1-27), and keeping the copies in wanted items' specs in
 * step with them.
 *
 * A spec version is immutable (§4), so a change to a shared criterion reaches an item the way any
 * change does: as version N+1, with a note saying why. Only the item's current version is looked
 * at — an older one is history, and the criterion it held then is what judged its verdicts.
 */

export class DuplicateSharedCriterionError extends Error {
  override readonly name = 'DuplicateSharedCriterionError';
  constructor(readonly key: string) {
    super(`There is already a shared criterion called ${key}.`);
  }
}

export class UnknownSharedCriterionError extends Error {
  override readonly name = 'UnknownSharedCriterionError';
  constructor(readonly key: string) {
    super(`No shared criterion is called ${key}.`);
  }
}

/**
 * Two criteria in one spec with the same id. The reviewer's answers are matched to criteria by id
 * (§9), so the second would take the first one's result.
 */
export class RepeatedCriterionError extends Error {
  override readonly name = 'RepeatedCriterionError';
  constructor(readonly criterionId: string) {
    super(`Two criteria have the id ${criterionId}; each criterion needs its own.`);
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const linking = (key: string) =>
  sql`${specVersions.criteria} @> ${JSON.stringify([{ shared: key }])}::jsonb`;

// Drizzle writes a column inside `sql` without its table, so the correlated columns are qualified
// by hand (P1-22's finding).
const columns = {
  id: sharedCriteria.id,
  key: sharedCriteria.key,
  text: sharedCriteria.text,
  kind: sharedCriteria.kind,
  quantifiable: sharedCriteria.quantifiable,
  onUnknown: sharedCriteria.onUnknown,
  tags: sharedCriteria.tags,
  items: sql<number>`(select count(*)::int from ${wantedItems} join ${specVersions} on ${specVersions}.id = ${wantedItems}.current_spec_version_id where ${specVersions}.criteria @> jsonb_build_array(jsonb_build_object('shared', ${sharedCriteria}.key)))`,
  createdAt: sharedCriteria.createdAt,
  updatedAt: sharedCriteria.updatedAt,
};

/** By identifier, which is already lowercase. */
export async function listSharedCriteria(db: Database): Promise<SharedCriterion[]> {
  return db.select(columns).from(sharedCriteria).orderBy(asc(sharedCriteria.key));
}

export async function createSharedCriterion(
  db: Database,
  input: SharedCriterionCreateInput,
): Promise<SharedCriterion> {
  const [clash] = await db
    .select({ id: sharedCriteria.id })
    .from(sharedCriteria)
    .where(eq(sharedCriteria.key, input.key))
    .limit(1);
  if (clash) throw new DuplicateSharedCriterionError(input.key);

  const [row] = await db.insert(sharedCriteria).values(input).returning({ id: sharedCriteria.id });
  if (!row) throw new Error('the shared criterion was not inserted');
  return readSharedCriterion(db, row.id) as Promise<SharedCriterion>;
}

export interface SharedCriterionUpdate {
  criterion: SharedCriterion;
  /** Wanted items given a new version because their copy changed. */
  updatedItems: number;
}

/**
 * Saves the shared criterion and writes version N+1 on every item whose copy it changes, in one
 * transaction so no item is left disagreeing with it. A change only to the tags, or to a field
 * no item's copy differs on, writes no version. Undefined when there is no such criterion.
 */
export async function updateSharedCriterion(
  db: Database,
  id: string,
  input: SharedCriterionUpdateInput,
): Promise<SharedCriterionUpdate | undefined> {
  const updatedItems = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(sharedCriteria)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(sharedCriteria.id, id))
      .returning();
    if (!row) return undefined;

    const fixed = lockedFields(row);
    return rewriteLinkedCriteria(
      tx,
      row.key,
      (criterion) => Object.assign(criterion, fixed),
      `Updated the shared criterion ${row.key}.`,
    );
  });
  if (updatedItems === undefined) return undefined;

  const criterion = await readSharedCriterion(db, id);
  return criterion ? { criterion, updatedItems } : undefined;
}

/**
 * False when there was no such criterion. Items using it keep their copy as a criterion of their
 * own, with a version saying so, rather than the delete being refused: the Criteria page names the
 * count before asking, as deleting a category does.
 */
export async function deleteSharedCriterion(db: Database, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(sharedCriteria)
      .where(eq(sharedCriteria.id, id))
      .returning({ key: sharedCriteria.key });
    if (!row) return false;

    await rewriteLinkedCriteria(
      tx,
      row.key,
      (criterion) => {
        delete criterion.shared;
      },
      `The shared criterion ${row.key} was deleted; this item keeps it as its own.`,
    );
    return true;
  });
}

/**
 * The spec with every linked criterion brought into line with its shared criterion, for a create
 * or a save to store. Refuses an identifier that names nothing, and two criteria with one id —
 * which is also what stops one shared criterion being linked twice.
 */
export async function resolveSharedCriteria(
  db: Pick<Database, 'select'>,
  spec: WantedSpec,
): Promise<WantedSpec> {
  const keys = [...new Set(spec.criteria.flatMap(({ shared }) => (shared ? [shared] : [])))];
  const rows: SharedCriterionFields[] =
    keys.length === 0
      ? []
      : await db
          .select({
            key: sharedCriteria.key,
            text: sharedCriteria.text,
            kind: sharedCriteria.kind,
            quantifiable: sharedCriteria.quantifiable,
            onUnknown: sharedCriteria.onUnknown,
          })
          .from(sharedCriteria)
          .where(inArray(sharedCriteria.key, keys));
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const criteria = spec.criteria.map((criterion) => {
    if (!criterion.shared) return criterion;
    const shared = byKey.get(criterion.shared);
    if (!shared) throw new UnknownSharedCriterionError(criterion.shared);
    return { ...criterion, ...lockedFields(shared) };
  });

  const ids = new Set<string>();
  for (const { id } of criteria) {
    if (ids.has(id)) throw new RepeatedCriterionError(id);
    ids.add(id);
  }

  return { ...spec, criteria };
}

/**
 * Version N+1 for each item whose current spec links `key` and whose criteria `rewrite` changes.
 * The rest of the version is copied as stored rather than parsed, so an item whose spec the schema
 * no longer reads is still kept in step.
 */
async function rewriteLinkedCriteria(
  tx: Transaction,
  key: string,
  rewrite: (criterion: Record<string, unknown>) => void,
  changeNote: string,
): Promise<number> {
  const rows = await tx
    .select({ itemId: wantedItems.id, current: specVersions })
    .from(wantedItems)
    .innerJoin(specVersions, eq(specVersions.id, wantedItems.currentSpecVersionId))
    .where(linking(key));

  let updated = 0;
  for (const { itemId, current } of rows) {
    const criteria = structuredClone(current.criteria);
    for (const entry of criteria) {
      if (isRecord(entry) && entry.shared === key) rewrite(entry);
    }
    if (isDeepStrictEqual(criteria, current.criteria)) continue;

    const [highest] = await tx
      .select({ version: max(specVersions.version) })
      .from(specVersions)
      .where(eq(specVersions.wantedItemId, itemId));
    const { id: _, createdAt: __, ...copied } = current;

    const [row] = await tx
      .insert(specVersions)
      .values({
        ...copied,
        version: (highest?.version ?? current.version) + 1,
        createdBy: 'manual_edit',
        criteria,
        changeNote,
      })
      .returning({ id: specVersions.id });
    if (!row) throw new Error('the spec version was not inserted');

    await tx
      .update(wantedItems)
      .set({ currentSpecVersionId: row.id, updatedAt: new Date() })
      .where(eq(wantedItems.id, itemId));
    updated += 1;
  }
  return updated;
}

async function readSharedCriterion(db: Database, id: string): Promise<SharedCriterion | undefined> {
  const [row] = await db.select(columns).from(sharedCriteria).where(eq(sharedCriteria.id, id));
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
