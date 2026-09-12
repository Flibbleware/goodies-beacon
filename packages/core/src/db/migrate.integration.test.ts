import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from './client.js';
import { runMigrations } from './migrate.js';

/**
 * Opt-in: set TEST_DATABASE_URL to a throwaway database to run these. CI has no Postgres,
 * so without it the suite reports them as skipped rather than failing.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl) : undefined;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!databaseUrl)('runMigrations against a real Postgres', () => {
  it('creates the Phase 0 tables and is idempotent when run twice', async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    await runMigrations(url);

    const tables = await pool?.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(tables?.rows.map((row) => row.tablename)).toEqual([
      'auth_session',
      'auth_user',
      'settings',
    ]);

    const applied = await pool?.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(applied?.rows[0]?.count).toBe('1');
  });

  it('survives concurrent callers, because the advisory lock serialises them', async () => {
    const url = databaseUrl as string;
    await expect(
      Promise.all([runMigrations(url), runMigrations(url), runMigrations(url)]),
    ).resolves.toHaveLength(3);

    const applied = await pool?.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(applied?.rows[0]?.count).toBe('1');
  });
});
