import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { gradingScales, media, specVersions, wantedItems } from '../db/schema.js';
import { wantedSpecSchema } from '../domain/spec.js';
import { itemSaveSchema } from './schema.js';
import {
  createItem,
  listItems,
  loadItem,
  saveItem,
  UnknownGradingScaleError,
  UnknownImageError,
  updateItem,
} from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

const example = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../domain/fixtures/${name}.json`, import.meta.url), 'utf8'));

/** A media row without the file behind it, which nothing here reads. */
async function storedImage(): Promise<string> {
  const hash = randomUUID();
  const [row] = await db
    .insert(media)
    .values({
      kind: 'reference',
      path: `test/${hash}.webp`,
      contentHash: hash,
      contentType: 'image/webp',
      bytes: 1,
    })
    .returning({ id: media.id });
  if (!row) throw new Error('the media row was not inserted');
  return row.id;
}

/** What the editor posts: a title, a status and the spec document itself. */
function input(title: string, spec: unknown, overrides: Record<string, unknown> = {}) {
  return itemSaveSchema.parse({ title, spec, ...overrides });
}

describe.skipIf(!databaseUrl)('the wanted item store against a real Postgres', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(wantedItems);
    await db.delete(gradingScales);
  });

  it('stores an example spec whole, so what is read back is what was pasted in', async () => {
    const spec = example('carmageddon');
    const { itemId, version } = await createItem(db, input('Carmageddon big box', spec));

    expect(version).toBe(1);

    const loaded = await loadItem(db, itemId);
    const stored = wantedSpecSchema.parse(loaded?.current?.document);
    const pasted = wantedSpecSchema.parse(spec);

    expect(JSON.parse(JSON.stringify(stored.settings))).toEqual(
      JSON.parse(JSON.stringify(pasted.settings)),
    );
    expect(stored.criteria).toEqual(pasted.criteria);
    expect(stored.searchPlans).toEqual(pasted.searchPlans);
    expect(stored.summary).toBe(pasted.summary);
    expect(stored.plausibilityNote).toBe(pasted.plausibilityNote);
  });

  it('records the spec as manually edited whatever the document claims', async () => {
    const spec = { ...(example('carmageddon') as object), createdBy: 'interview' };
    const { itemId } = await createItem(db, input('Carmageddon big box', spec));

    const loaded = await loadItem(db, itemId);
    expect(loaded?.current?.document.createdBy).toBe('manual_edit');
  });

  it('keeps the note in the document when the change-note field is left empty', async () => {
    const { itemId } = await createItem(db, input('Carmageddon big box', example('carmageddon')));

    const loaded = await loadItem(db, itemId);
    expect(loaded?.versions[0]?.changeNote).toBe('First version, entered by hand.');
  });

  it('lets the change-note field override the one in the document', async () => {
    const { itemId } = await createItem(
      db,
      input('Carmageddon big box', example('carmageddon'), { changeNote: 'Typed by hand.' }),
    );

    const loaded = await loadItem(db, itemId);
    expect(loaded?.versions[0]?.changeNote).toBe('Typed by hand.');
  });

  /**
   * The immutability §4 asks for. A save that edited the row in place would rewrite the spec a
   * verdict already recorded itself against, which is the one thing the version table exists to
   * stop.
   */
  it('writes a new version on every save and leaves the earlier ones untouched', async () => {
    const spec = example('carmageddon') as Record<string, unknown>;
    const { itemId } = await createItem(db, input('Carmageddon big box', spec));

    const saved = await saveItem(
      db,
      itemId,
      input(
        'Carmageddon big box',
        { ...spec, summary: 'Now Macintosh only.' },
        {
          changeNote: 'Macintosh only.',
        },
      ),
    );

    expect(saved?.version).toBe(2);

    const loaded = await loadItem(db, itemId);
    expect(loaded?.versions.map((row) => row.version)).toEqual([2, 1]);
    expect(loaded?.current?.version).toBe(2);
    expect(loaded?.current?.document.summary).toBe('Now Macintosh only.');

    const [first] = await db
      .select({ summary: specVersions.summary })
      .from(specVersions)
      .where(eq(specVersions.version, 1));
    expect(first?.summary).toBe(spec.summary);
  });

  /**
   * The scheduler reads `poll_every` from the item row and the review pipeline reads
   * `notification_mode` from it, so a spec saying `realtime` with the column left at `digest`
   * would be an item that agrees with itself on screen and emails nobody.
   */
  it('projects the settings the runtime reads from the row onto the item', async () => {
    const spec = example('carmageddon') as Record<string, unknown>;
    const settings = spec.settings as Record<string, unknown>;

    const { itemId } = await createItem(
      db,
      input('Carmageddon big box', {
        ...spec,
        settings: { ...settings, notificationMode: 'realtime', pollEvery: 'PT4H' },
      }),
    );

    const [row] = await db.select().from(wantedItems).where(eq(wantedItems.id, itemId));
    expect(row?.notificationMode).toBe('realtime');
    expect(row?.pollEvery).toBe('PT4H');

    await saveItem(
      db,
      itemId,
      input('Carmageddon big box', {
        ...spec,
        settings: { ...settings, notificationMode: 'digest', pollEvery: null },
      }),
    );

    const [after] = await db.select().from(wantedItems).where(eq(wantedItems.id, itemId));
    expect(after?.notificationMode).toBe('digest');
    expect(after?.pollEvery).toBeNull();
  });

  it('starts an item as a draft and takes the status the editor sends', async () => {
    const spec = example('power-mac-5500');
    const draft = await createItem(db, input('Power Mac 5500', spec));
    const active = await createItem(db, input('Carmageddon', spec, { status: 'active' }));

    const items = await listItems(db);
    expect(items.find((row) => row.id === draft.itemId)?.status).toBe('draft');
    expect(items.find((row) => row.id === active.itemId)?.status).toBe('active');
  });

  it('names the grading scale rather than failing on a foreign key nobody typed', async () => {
    const spec = example('carmageddon') as Record<string, unknown>;
    const settings = spec.settings as Record<string, unknown>;
    const missing = '00000000-0000-4000-8000-000000000000';

    await expect(
      createItem(
        db,
        input('Carmageddon big box', {
          ...spec,
          settings: { ...settings, gradingScaleId: missing },
        }),
      ),
    ).rejects.toThrow(UnknownGradingScaleError);

    expect(await listItems(db)).toEqual([]);
  });

  it('answers with nothing for an item that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    expect(await loadItem(db, missing)).toBeUndefined();
    expect(await saveItem(db, missing, input('Nothing', example('carmageddon')))).toBeUndefined();
  });

  it('lists the newest first with the version polling is using', async () => {
    const spec = example('carmageddon');
    const first = await createItem(db, input('First', spec));
    await createItem(db, input('Second', spec));
    await saveItem(db, first.itemId, input('First', spec));

    const items = await listItems(db);
    expect(items.map((row) => row.title)).toEqual(['First', 'Second']);
    expect(items[0]?.currentVersion).toBe(2);
    expect(items[1]?.currentVersion).toBe(1);
  });

  describe("the item's own fields, which are not the spec (P1-25)", () => {
    it('renames, recategorises and pauses an item without writing a version', async () => {
      const { itemId } = await createItem(
        db,
        input('Carmageddon', example('carmageddon'), { status: 'active' }),
      );

      const updated = await updateItem(db, itemId, {
        title: 'Carmageddon big box, Mac or PC',
        status: 'paused',
        categoryId: null,
      });

      expect(updated).toMatchObject({ title: 'Carmageddon big box, Mac or PC', status: 'paused' });
      const loaded = await loadItem(db, itemId);
      expect(loaded?.title).toBe('Carmageddon big box, Mac or PC');
      expect(loaded?.versions).toHaveLength(1);
    });

    it('sets and clears a display image, leaving every field it was not given alone', async () => {
      const { itemId } = await createItem(
        db,
        input('Carmageddon', example('carmageddon'), { status: 'active' }),
      );
      const image = await storedImage();

      await updateItem(db, itemId, { displayImageId: image });
      const loaded = await loadItem(db, itemId);
      expect(loaded?.displayImageId).toBe(image);
      expect(loaded?.title).toBe('Carmageddon');
      expect(loaded?.status).toBe('active');
      expect(loaded?.versions).toHaveLength(1);
      // The spec — the only thing the pipeline reads — has not heard of it.
      expect(JSON.stringify(loaded?.current?.document)).not.toContain(image);
      expect((await listItems(db))[0]?.displayImageId).toBe(image);

      await updateItem(db, itemId, { displayImageId: null });
      expect((await loadItem(db, itemId))?.displayImageId).toBeNull();

      await db.delete(media).where(eq(media.id, image));
    });

    it('names the image rather than failing on a foreign key nobody typed', async () => {
      const { itemId } = await createItem(db, input('Carmageddon', example('carmageddon')));

      await expect(
        updateItem(db, itemId, { displayImageId: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toThrow(UnknownImageError);
    });

    it('leaves an item without a display image when the stored image is deleted', async () => {
      const { itemId } = await createItem(db, input('Carmageddon', example('carmageddon')));
      const image = await storedImage();
      await updateItem(db, itemId, { displayImageId: image });

      await db.delete(media).where(eq(media.id, image));

      expect((await loadItem(db, itemId))?.displayImageId).toBeNull();
    });

    it('answers with nothing for an item that does not exist', async () => {
      expect(
        await updateItem(db, '00000000-0000-4000-8000-000000000000', { title: 'Nothing' }),
      ).toBeUndefined();
    });
  });
});
