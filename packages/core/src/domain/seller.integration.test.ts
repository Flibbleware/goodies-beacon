import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecryptionError, isEncrypted } from '../crypto.js';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { instanceSecret } from '../db/schema.js';
import { loadSellerSalt, sellerHash } from './seller.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!databaseUrl)('the seller salt against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(instanceSecret);
  });

  it('generates a salt on first use and returns the same one afterwards', async () => {
    const first = await loadSellerSalt(db, KEY);
    const second = await loadSellerSalt(db, KEY);

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(20);
  });

  it('stores the salt encrypted, so a stolen database cannot hash a wordlist of usernames', async () => {
    const salt = await loadSellerSalt(db, KEY);
    const [row] = await db.select().from(instanceSecret);

    expect(row).toBeDefined();
    expect(isEncrypted(row?.sellerSalt ?? '')).toBe(true);
    expect(row?.sellerSalt).not.toContain(salt);
  });

  it('refuses to read the salt under the wrong key rather than returning rubbish', async () => {
    await loadSellerSalt(db, KEY);
    await expect(loadSellerSalt(db, OTHER_KEY)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('settles on one salt when several workers start at once on a fresh instance', async () => {
    const salts = await Promise.all(Array.from({ length: 5 }, () => loadSellerSalt(db, KEY)));

    expect(new Set(salts).size).toBe(1);
    const rows = await db.select().from(instanceSecret);
    expect(rows).toHaveLength(1);
  });

  it('survives the master key being rotated, which a derived salt would not', async () => {
    const before = await loadSellerSalt(db, KEY);
    const hashBefore = sellerHash('ebay', 'collector99', before);

    // Rotation re-wraps the one row; §4 turns on the hashes still matching afterwards.
    const [row] = await db.select().from(instanceSecret);
    const { decryptSecret, encryptSecret } = await import('../crypto.js');
    const plain = decryptSecret(row?.sellerSalt ?? '', KEY);
    await db
      .update(instanceSecret)
      .set({ sellerSalt: encryptSecret(plain, OTHER_KEY) })
      .where(sql`${instanceSecret.id} = 1`);

    const after = await loadSellerSalt(db, OTHER_KEY);
    expect(after).toBe(before);
    expect(sellerHash('ebay', 'collector99', after)).toBe(hashBefore);
  });
});

describe.skipIf(!databaseUrl)('the listings table', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool ??= createPool(databaseUrl as string);
    db = createDb(pool);
  });

  it('has no column that could hold a seller name (ARCHITECTURE.md §4)', async () => {
    const result = await pool?.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'listings'`,
    );
    const columns = (result?.rows ?? []).map((row) => row.column_name);

    expect(columns).toContain('seller_hash');
    // Not an exhaustive guard — it cannot be — but it fails loudly if the obvious one comes back.
    for (const forbidden of ['seller_name', 'seller_id', 'seller_username', 'seller']) {
      expect(columns).not.toContain(forbidden);
    }
  });
});
