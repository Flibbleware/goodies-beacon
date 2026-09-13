import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { sourceCookies } from '../db/schema.js';
import { createCookieJar } from './cookies.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!databaseUrl)('the cookie jar against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(sourceCookies);
  });

  /**
   * The reason the jar is in the database at all (§5). A "restart" here is a second jar built
   * over the same database with no shared memory — which is exactly what a redeployed worker is.
   */
  it('survives a process restart', async () => {
    const before = createCookieJar(db, 'vinted');
    await before.store('vinted.co.uk', ['datadome=abc123; Path=/; Secure']);

    const afterRestart = createCookieJar(db, 'vinted');

    await expect(afterRestart.header('vinted.co.uk')).resolves.toBe('datadome=abc123');
  });

  it('returns null for a domain it has never seen', async () => {
    const jar = createCookieJar(db, 'vinted');

    await expect(jar.header('vinted.fr')).resolves.toBeNull();
  });

  it('keeps each domain separate, since every Vinted country is its own session', async () => {
    const jar = createCookieJar(db, 'vinted');
    await jar.store('vinted.co.uk', ['datadome=uk-session']);
    await jar.store('vinted.fr', ['datadome=fr-session']);

    await expect(jar.header('vinted.co.uk')).resolves.toBe('datadome=uk-session');
    await expect(jar.header('vinted.fr')).resolves.toBe('datadome=fr-session');
  });

  it('keeps each source separate', async () => {
    await createCookieJar(db, 'vinted').store('example.com', ['a=vinted']);
    await createCookieJar(db, 'mercari_jp').store('example.com', ['a=mercari']);

    await expect(createCookieJar(db, 'vinted').header('example.com')).resolves.toBe('a=vinted');
    await expect(createCookieJar(db, 'mercari_jp').header('example.com')).resolves.toBe(
      'a=mercari',
    );
  });

  it('replaces a cookie when the server sends a new value for the same name', async () => {
    const jar = createCookieJar(db, 'vinted');
    await jar.store('vinted.co.uk', ['datadome=first']);
    await jar.store('vinted.co.uk', ['datadome=second']);

    await expect(jar.header('vinted.co.uk')).resolves.toBe('datadome=second');
    expect(await db.select().from(sourceCookies)).toHaveLength(1);
  });

  it('sends several cookies as one header, in the order stored', async () => {
    const jar = createCookieJar(db, 'vinted');
    await jar.store('vinted.co.uk', ['datadome=abc', 'session=xyz']);

    const header = await jar.header('vinted.co.uk');

    expect(header).toContain('datadome=abc');
    expect(header).toContain('session=xyz');
    expect(header?.split('; ')).toHaveLength(2);
  });

  it('drops an expired cookie on read, so a worker that slept does not send a stale one', async () => {
    let clock = new Date('2026-09-13T12:00:00.000Z');
    const jar = createCookieJar(db, 'vinted', () => clock);
    await jar.store('vinted.co.uk', ['short=lived; Max-Age=60', 'long=lasting; Max-Age=86400']);

    clock = new Date('2026-09-13T12:05:00.000Z');

    await expect(jar.header('vinted.co.uk')).resolves.toBe('long=lasting');
    expect(await db.select().from(sourceCookies)).toHaveLength(1);
  });

  it('keeps a session cookie, which has no expiry at all', async () => {
    let clock = new Date('2026-09-13T12:00:00.000Z');
    const jar = createCookieJar(db, 'vinted', () => clock);
    await jar.store('vinted.co.uk', ['datadome=abc123']);

    clock = new Date('2027-09-13T12:00:00.000Z');

    await expect(jar.header('vinted.co.uk')).resolves.toBe('datadome=abc123');
  });

  it('clears one domain without touching the others', async () => {
    const jar = createCookieJar(db, 'vinted');
    await jar.store('vinted.co.uk', ['a=uk']);
    await jar.store('vinted.fr', ['a=fr']);

    await jar.clear('vinted.co.uk');

    await expect(jar.header('vinted.co.uk')).resolves.toBeNull();
    await expect(jar.header('vinted.fr')).resolves.toBe('a=fr');
  });

  it('clears every domain for the source when given none', async () => {
    const jar = createCookieJar(db, 'vinted');
    await jar.store('vinted.co.uk', ['a=uk']);
    await jar.store('vinted.fr', ['a=fr']);

    await jar.clear();

    await expect(jar.header('vinted.co.uk')).resolves.toBeNull();
    await expect(jar.header('vinted.fr')).resolves.toBeNull();
  });
});
