import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { sharedCriteria, specVersions, wantedItems } from '../db/schema.js';
import {
  sharedCriterionCreateSchema,
  sharedCriterionUpdateSchema,
} from '../domain/shared-criterion.js';
import { type Criterion, wantedSpecSchema } from '../domain/spec.js';
import { itemSaveSchema } from '../items/schema.js';
import { createItem, loadItem, saveItem } from '../items/store.js';
import {
  createSharedCriterion,
  DuplicateSharedCriterionError,
  deleteSharedCriterion,
  listSharedCriteria,
  RepeatedCriterionError,
  UnknownSharedCriterionError,
  updateSharedCriterion,
} from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

const carmageddon = JSON.parse(
  readFileSync(new URL('../domain/fixtures/carmageddon.json', import.meta.url), 'utf8'),
) as { criteria: Criterion[] } & Record<string, unknown>;

const CLASSICS = 'original-release-not-classics';

function classics(overrides: Record<string, unknown> = {}) {
  return sharedCriterionCreateSchema.parse({
    key: CLASSICS,
    text: 'The original release, not the Nintendo Classics re-release',
    kind: 'hard',
    tags: ['game boy'],
    ...overrides,
  });
}

/** The Carmageddon example with one more criterion on the end. */
function specWith(criterion: Record<string, unknown>) {
  return { ...carmageddon, criteria: [...carmageddon.criteria, criterion] };
}

/** The same criterion as an update carries it: everything but the identifier. */
function changed(text: string) {
  const { key: _, ...fields } = classics();
  return sharedCriterionUpdateSchema.parse({ ...fields, text });
}

const linked = (overrides: Record<string, unknown> = {}) => ({
  id: CLASSICS,
  shared: CLASSICS,
  text: 'whatever the item happened to hold',
  kind: 'soft',
  quantifiable: false,
  onUnknown: 'reject',
  ...overrides,
});

async function currentCriteria(itemId: string): Promise<Criterion[]> {
  const item = await loadItem(db, itemId);
  return wantedSpecSchema.parse(item?.current?.document).criteria;
}

async function versionOf(itemId: string): Promise<number | undefined> {
  return (await loadItem(db, itemId))?.current?.version;
}

describe.skipIf(!databaseUrl)('the shared criteria store against a real Postgres', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(wantedItems);
    await db.delete(sharedCriteria);
  });

  it('creates one, lists it by identifier with how many items use it, and refuses its twin', async () => {
    await createSharedCriterion(db, classics());
    await createSharedCriterion(db, classics({ key: 'boxed', text: 'Boxed' }));

    const { itemId } = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Tetris', spec: specWith(linked()) }),
    );
    expect(itemId).toBeDefined();

    const listed = await listSharedCriteria(db);
    expect(listed.map(({ key, items, tags }) => ({ key, items, tags }))).toEqual([
      { key: 'boxed', items: 0, tags: ['game boy'] },
      { key: CLASSICS, items: 1, tags: ['game boy'] },
    ]);

    await expect(createSharedCriterion(db, classics())).rejects.toBeInstanceOf(
      DuplicateSharedCriterionError,
    );
  });

  it('writes the text and the fields it fixes over an item copy on save, leaving the rest', async () => {
    await createSharedCriterion(db, classics());

    const { itemId } = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Tetris', spec: specWith(linked()) }),
    );

    const criterion = (await currentCriteria(itemId)).at(-1);
    expect(criterion).toEqual({
      id: CLASSICS,
      shared: CLASSICS,
      text: 'The original release, not the Nintendo Classics re-release',
      kind: 'hard',
      // Left open by the shared criterion, so the item's own choices stand.
      quantifiable: false,
      onUnknown: 'reject',
    });
  });

  it('refuses an identifier that names no shared criterion, and a criterion used twice', async () => {
    await expect(
      createItem(db, itemSaveSchema.parse({ title: 'Tetris', spec: specWith(linked()) })),
    ).rejects.toBeInstanceOf(UnknownSharedCriterionError);

    await createSharedCriterion(db, classics());
    const twice = { ...carmageddon, criteria: [linked(), linked()] };
    await expect(
      createItem(db, itemSaveSchema.parse({ title: 'Tetris', spec: twice })),
    ).rejects.toBeInstanceOf(RepeatedCriterionError);
  });

  it('writes a version on each item using it when it changes, and on no other', async () => {
    const criterion = await createSharedCriterion(db, classics());
    const using = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Tetris', spec: specWith(linked()) }),
    );
    const notUsing = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Carmageddon', spec: carmageddon }),
    );

    const result = await updateSharedCriterion(db, criterion.id, {
      text: 'The original release in the grey-banded box, not Nintendo Classics',
      kind: 'soft',
      quantifiable: true,
      onUnknown: null,
      tags: ['game boy'],
    });

    expect(result?.updatedItems).toBe(1);
    expect(await versionOf(using.itemId)).toBe(2);
    expect(await versionOf(notUsing.itemId)).toBe(1);
    expect((await currentCriteria(using.itemId)).at(-1)).toEqual({
      id: CLASSICS,
      shared: CLASSICS,
      text: 'The original release in the grey-banded box, not Nintendo Classics',
      kind: 'soft',
      quantifiable: true,
      onUnknown: 'reject',
    });
    // The other criteria are untouched, and the note says why the version exists.
    expect((await currentCriteria(using.itemId)).slice(0, -1)).toEqual(
      wantedSpecSchema.parse(carmageddon).criteria,
    );
    const item = await loadItem(db, using.itemId);
    expect(item?.versions[0]?.changeNote).toBe(`Updated the shared criterion ${CLASSICS}.`);
    expect(item?.status).toBe('draft');
  });

  it('writes no version when nothing an item holds changes, such as the tags', async () => {
    const criterion = await createSharedCriterion(db, classics());
    const { itemId } = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Tetris', spec: specWith(linked()) }),
    );

    const result = await updateSharedCriterion(db, criterion.id, {
      text: criterion.text,
      kind: criterion.kind,
      quantifiable: criterion.quantifiable,
      onUnknown: criterion.onUnknown,
      tags: ['game boy', 'nintendo'],
    });

    expect(result?.updatedItems).toBe(0);
    expect(result?.criterion.tags).toEqual(['game boy', 'nintendo']);
    expect(await versionOf(itemId)).toBe(1);
  });

  it('only follows an item current version, not one it has since dropped the criterion from', async () => {
    const criterion = await createSharedCriterion(db, classics());
    const { itemId } = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Tetris', spec: specWith(linked()) }),
    );
    await saveItem(db, itemId, itemSaveSchema.parse({ title: 'Tetris', spec: carmageddon }));

    const result = await updateSharedCriterion(db, criterion.id, changed('Changed'));

    expect(result?.updatedItems).toBe(0);
    expect(await versionOf(itemId)).toBe(2);
  });

  it('on delete, leaves each item using it the criterion as its own, in a new version', async () => {
    const criterion = await createSharedCriterion(db, classics());
    const { itemId } = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Tetris', spec: specWith(linked()) }),
    );

    expect(await deleteSharedCriterion(db, criterion.id)).toBe(true);
    expect(await deleteSharedCriterion(db, criterion.id)).toBe(false);

    expect(await versionOf(itemId)).toBe(2);
    const kept = (await currentCriteria(itemId)).at(-1);
    expect(kept).toEqual({
      id: CLASSICS,
      text: 'The original release, not the Nintendo Classics re-release',
      kind: 'hard',
      quantifiable: false,
      onUnknown: 'reject',
    });
    // An ordinary criterion now, so the item saves without the shared one existing.
    await expect(
      saveItem(
        db,
        itemId,
        itemSaveSchema.parse({ title: 'Tetris', spec: specWith(kept as Criterion) }),
      ),
    ).resolves.toBeDefined();
  });

  it('keeps an item in step even when its stored spec no longer parses', async () => {
    const criterion = await createSharedCriterion(db, classics());
    const { itemId } = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Tetris', spec: specWith(linked()) }),
    );
    const item = await loadItem(db, itemId);
    await db
      .update(specVersions)
      .set({ settings: { sources: 'not a list' } })
      .where(eq(specVersions.id, item?.current?.versionId as string));

    const result = await updateSharedCriterion(db, criterion.id, changed('Changed'));

    expect(result?.updatedItems).toBe(1);
    const updated = await loadItem(db, itemId);
    expect(updated?.current?.document.settings).toEqual({ sources: 'not a list' });
    const criteria = updated?.current?.document.criteria as Criterion[] | undefined;
    expect(criteria?.at(-1)?.text).toBe('Changed');
  });
});
