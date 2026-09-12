import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, isEncrypted } from '../crypto.js';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { settings } from '../db/schema.js';
import { DEFAULT_DIGEST_TIME, DEFAULT_SMTP_PORT, DEFAULT_TIMEZONE } from './schema.js';
import { readSettings, resolveSmtp, writeSettings } from './store.js';

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
    });
  });

  it('encrypts the SMTP password rather than storing what was typed', async () => {
    await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);

    const [row] = await db.select().from(settings);
    const stored = (row as { data: { email: { password: string } } }).data.email.password;

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

  it('does not encrypt an envelope twice, so a round-trip through the store is safe', async () => {
    await writeSettings(db, { email: { ...CONFIGURED, password: 'hunter2' } }, KEY);
    const once = await readSettings(db);

    await writeSettings(db, { email: { password: once.email.password } }, KEY);

    expect(decryptSecret((await readSettings(db)).email.password, KEY)).toBe('hunter2');
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
