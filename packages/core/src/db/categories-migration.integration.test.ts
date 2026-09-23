import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';

/**
 * P1-22 turned the seven built-in categories into rows. This proves the conversion on a database
 * that was at P1-21 with real rows in it, which the ordinary migration test cannot: it starts from
 * empty, so the INSERT … SELECT has nothing to convert.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
/** The last migration before P1-22's. */
const BEFORE = '0011_red_steel_serpent';

const scratch = `gb_categories_${process.pid}_${Date.now()}`;
let admin: Pool | undefined;
let pool: Pool | undefined;
let url: string;
let folder: string | undefined;

describe.skipIf(!databaseUrl)('the P1-22 category migration', () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(`create database ${scratch}`);
    const parsed = new URL(databaseUrl as string);
    parsed.pathname = `/${scratch}`;
    url = parsed.toString();
    pool = new Pool({ connectionString: url, max: 1 });

    // Drizzle applies whatever the journal lists, so a copy that stops at P1-21 is P1-21.
    folder = mkdtempSync(join(tmpdir(), 'gb-migrations-'));
    mkdirSync(join(folder, 'meta'));
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'));
    const stop = journal.entries.findIndex((entry: { tag: string }) => entry.tag === BEFORE);
    journal.entries = journal.entries.slice(0, stop + 1);
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries as { tag: string }[]) {
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    await migrate(drizzle(pool), { migrationsFolder: folder });

    await pool.query(`
      insert into wish_items (label, category) values
        ('Jurassic Park', 'vhs'), ('Tamagotchi', 'toy'), ('Something', 'other');
      insert into wanted_items (title, category) values
        ('Carmageddon', 'game'), ('Jaws', 'vhs'), ('Unsorted', 'other');
    `);

    await runMigrations(url);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${scratch} with (force)`);
    await admin?.end();
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  it('creates a category for each built-in one in use, as it was drawn, and no Other', async () => {
    const rows = await pool?.query('select name, icon, colour from categories order by name');
    expect(rows?.rows).toEqual([
      { name: 'Game', icon: 'gamepad', colour: 'violet' },
      { name: 'Toy', icon: 'robot', colour: 'pink' },
      { name: 'VHS', icon: 'cassette', colour: 'blue' },
    ]);
  });

  it('points every wish and item at its category, and Other at none', async () => {
    const wishes = await pool?.query(`
      select w.label, c.name from wish_items w left join categories c on c.id = w.category_id
      order by w.label`);
    expect(wishes?.rows).toEqual([
      { label: 'Jurassic Park', name: 'VHS' },
      { label: 'Something', name: null },
      { label: 'Tamagotchi', name: 'Toy' },
    ]);

    const items = await pool?.query(`
      select i.title, c.name from wanted_items i left join categories c on c.id = i.category_id
      order by i.title`);
    expect(items?.rows).toEqual([
      { title: 'Carmageddon', name: 'Game' },
      { title: 'Jaws', name: 'VHS' },
      { title: 'Unsorted', name: null },
    ]);
  });

  it('drops the old text column', async () => {
    const columns = await pool?.query(`
      select table_name from information_schema.columns
      where column_name = 'category' and table_name in ('wish_items', 'wanted_items')`);
    expect(columns?.rows).toEqual([]);
  });
});
