import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, isEncrypted } from '../crypto.js';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { settings } from '../db/schema.js';
import {
  DEFAULT_DIGEST_TIME,
  DEFAULT_SMTP_PORT,
  DEFAULT_TIMEZONE,
  toPublicSettings,
} from './schema.js';
import { readSettings, resolveEbay, resolveSmtp, writeSettings } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

/** Enough for `isEmailConfigured` to be true, so a test send would be attempted. */
const CONFIGURED = {
  host: 'smtp.example.com',
  fromAddress: 'beacon@example.com',
  notificationAddress: 'owner@example.com',
};

describe.skipIf(!databaseUrl)('the settings store against a real Postgres', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(settings);
  });

  it('reads defaults out of an empty database', async () => {
    expect(await readSettings(db)).toEqual({
      instance: { timezone: DEFAULT_TIMEZONE, digestTime: DEFAULT_DIGEST_TIME },
      email: {
        host: '',
        port: DEFAULT_SMTP_PORT,
        security: 'starttls',
        username: '',
        password: '',
        fromAddress: '',
        notificationAddress: '',
      },
      sources: {
        ebay: { clientId: '', clientSecret: '', proxyUrl: '' },
      },
    });
  });

  it('encrypts the SMTP password rather than storing what was typed', async () => {
    await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);

    const [row] = await db.select().from(settings);
    const stored = (row?.data as { email?: { password?: string } } | undefined)?.email?.password;

    // Narrowed rather than asserted with expect(): `expect(undefined).not.toBe('hunter2')` passes,
    // so a write that silently stored nothing would have gone unnoticed.
    if (typeof stored !== 'string') throw new Error('no SMTP password was stored');

    expect(stored).not.toBe('hunter2');
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored, KEY)).toBe('hunter2');
  });

  it('keeps the stored password when a save leaves it out', async () => {
    await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);
    await writeSettings(db, { email: { host: 'smtp.elsewhere.com' } }, KEY);

    const saved = await readSettings(db);
    expect(saved.email.host).toBe('smtp.elsewhere.com');
    expect(decryptSecret(saved.email.password, KEY)).toBe('hunter2');
  });

  it('replaces the password when a new one is sent', async () => {
    await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);
    await writeSettings(db, { email: { password: 'correct-horse' } }, KEY);

    const saved = await readSettings(db);
    expect(decryptSecret(saved.email.password, KEY)).toBe('correct-horse');
  });

  it('clears the password when an empty one is sent, for a server with no login', async () => {
    await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);
    await writeSettings(db, { email: { password: '' } }, KEY);

    expect((await readSettings(db)).email.password).toBe('');
  });

  it('encrypts a submitted value that merely looks like a stored envelope', async () => {
    await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);
    const stored = (await readSettings(db)).email.password;

    await writeSettings(db, { email: { password: stored } }, KEY);

    // Taken as a new password, not passed through: what decrypts is the envelope itself.
    expect(decryptSecret((await readSettings(db)).email.password, KEY)).toBe(stored);
  });

  it('leaves the other section alone when one is saved', async () => {
    await writeSettings(db, { instance: { timezone: 'Asia/Tokyo' } }, KEY);
    await writeSettings(db, { email: { host: 'smtp.example.com' } }, KEY);

    const saved = await readSettings(db);
    expect(saved.instance.timezone).toBe('Asia/Tokyo');
    expect(saved.email.host).toBe('smtp.example.com');
  });

  describe('resolveSmtp', () => {
    it('hands the mailer a decrypted password', async () => {
      await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);

      expect(resolveSmtp(await readSettings(db), KEY)).toMatchObject({
        host: 'smtp.example.com',
        password: 'hunter2',
        notificationAddress: 'owner@example.com',
      });
    });

    it('is undefined until the host, from and notification addresses are all set', async () => {
      await writeSettings(db, { email: { host: 'smtp.example.com' } }, KEY);
      expect(resolveSmtp(await readSettings(db), KEY)).toBeUndefined();

      await writeSettings(db, { email: CONFIGURED }, KEY);
      expect(resolveSmtp(await readSettings(db), KEY)).toBeDefined();
    });

    it('refuses to guess when the key has changed rather than sending rubbish credentials', async () => {
      await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);
      const saved = await readSettings(db);

      expect(() => resolveSmtp(saved, OTHER_KEY)).toThrow(/GOODIES_BEACON_SECRET_KEY/);
    });
  });
});

describe.skipIf(!databaseUrl)('the eBay source settings', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool ??= createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(settings);
  });

  const KEYSET = { clientId: 'App-ID-1', clientSecret: 'PRD-secret', proxyUrl: '' };

  it('encrypts the client secret rather than storing what was typed', async () => {
    await writeSettings(db, { sources: { ebay: KEYSET } }, KEY);

    const [row] = await db.select().from(settings);
    const stored = (row?.data as { sources?: { ebay?: { clientSecret?: string } } } | undefined)
      ?.sources?.ebay?.clientSecret;

    if (typeof stored !== 'string') throw new Error('no client secret was stored');
    expect(stored).not.toBe('PRD-secret');
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored, KEY)).toBe('PRD-secret');
  });

  it('encrypts the proxy URL too, since it carries a username and password', async () => {
    await writeSettings(
      db,
      { sources: { ebay: { ...KEYSET, proxyUrl: 'http://user:pass@proxy.example:8080' } } },
      KEY,
    );

    const [row] = await db.select().from(settings);
    const stored = JSON.stringify(row?.data);

    expect(stored).not.toContain('user:pass');
    expect(resolveEbay(await readSettings(db), KEY)?.proxyUrl).toBe(
      'http://user:pass@proxy.example:8080',
    );
  });

  it('keeps the stored secret when a save leaves it out', async () => {
    await writeSettings(db, { sources: { ebay: KEYSET } }, KEY);
    await writeSettings(db, { sources: { ebay: { clientId: 'App-ID-2' } } }, KEY);

    const resolved = resolveEbay(await readSettings(db), KEY);

    expect(resolved?.clientId).toBe('App-ID-2');
    expect(resolved?.clientSecret).toBe('PRD-secret');
  });

  it('clears the secret when an empty string is sent, which is how a keyset is removed', async () => {
    await writeSettings(db, { sources: { ebay: KEYSET } }, KEY);
    await writeSettings(db, { sources: { ebay: { clientSecret: '' } } }, KEY);

    expect(resolveEbay(await readSettings(db), KEY)).toBeUndefined();
  });

  it('resolves to undefined until both halves of the keyset are present', async () => {
    await writeSettings(db, { sources: { ebay: { clientId: 'App-ID-1' } } }, KEY);

    expect(resolveEbay(await readSettings(db), KEY)).toBeUndefined();
  });

  it('never sends either secret to the browser, only whether there is one', async () => {
    await writeSettings(
      db,
      { sources: { ebay: { ...KEYSET, proxyUrl: 'http://user:pass@proxy.example:8080' } } },
      KEY,
    );

    const publicView = toPublicSettings(await readSettings(db));

    expect(JSON.stringify(publicView)).not.toContain('PRD-secret');
    expect(JSON.stringify(publicView)).not.toContain('proxy.example');
    expect(publicView.sources.ebay).toEqual({
      clientId: 'App-ID-1',
      clientSecretSet: true,
      proxySet: true,
    });
  });
});
