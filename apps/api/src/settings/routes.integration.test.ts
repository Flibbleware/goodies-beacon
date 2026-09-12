import {
  authSession,
  authUser,
  createDb,
  createPool,
  type Database,
  DEFAULT_DIGEST_TIME,
  DEFAULT_SMTP_PORT,
  DEFAULT_TIMEZONE,
  isEncrypted,
  type Logger,
  readSettings,
  runMigrations,
  settings,
} from '@goodies-beacon/core';
import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../auth/cookies.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const smtpUrl = process.env.TEST_SMTP_URL;
const mailpitUrl = process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025';

const PASSWORD = 'a-good-enough-password';
const HOST = 'beacon.example.co.uk';
const SECRET_KEY = 'IqQ8Xn1rWQhTsm9gOZ4vKdLpEbYxAcRuNjFkHt2SwVo=';
const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, child: () => logger };

/** Enough for the server to consider email configured. */
const CONFIGURED = {
  host: 'smtp.example.com',
  fromAddress: 'beacon@example.com',
  notificationAddress: 'owner@example.com',
};

let pool: Pool | undefined;
let db: Database;
let app: Hono;
let cookie: string;
let csrf: string;

afterAll(async () => {
  await pool?.end();
});

async function get(path = '/api/settings'): Promise<Response> {
  return app.request(path, { headers: { cookie } });
}

async function put(body: unknown): Promise<Response> {
  return app.request('/api/settings', {
    method: 'PUT',
    headers: { cookie, [CSRF_HEADER]: csrf, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function test_send(): Promise<Response> {
  return app.request('/api/settings/email/test', {
    method: 'POST',
    headers: { cookie, [CSRF_HEADER]: csrf },
  });
}

function cookieValue(res: Response, name: string): string | undefined {
  const line = res.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  const pair = line?.split(';')[0];
  return pair?.slice(pair.indexOf('=') + 1);
}

describe.skipIf(!databaseUrl)('the settings routes', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(authSession);
    await db.delete(authUser);
    await db.delete(settings);
    app = createApp({
      db,
      logger,
      config: { host: HOST, secretKey: SECRET_KEY, version: 'dev', sha: 'unknown' },
    });

    const start = await app.request('/api/auth/session');
    const token = cookieValue(start, CSRF_COOKIE) as string;
    const res = await app.request('/api/auth/first-run', {
      method: 'POST',
      headers: {
        cookie: `${CSRF_COOKIE}=${token}`,
        [CSRF_HEADER]: token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: PASSWORD }),
    });
    csrf = cookieValue(res, CSRF_COOKIE) as string;
    cookie = `${SESSION_COOKIE}=${cookieValue(res, SESSION_COOKIE)}; ${CSRF_COOKIE}=${csrf}`;
  });

  describe('reading', () => {
    it('needs a session', async () => {
      expect((await app.request('/api/settings')).status).toBe(401);
    });

    it('answers with the defaults before anything has been saved', async () => {
      const res = await get();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        settings: {
          instance: { timezone: DEFAULT_TIMEZONE, digestTime: DEFAULT_DIGEST_TIME },
          email: {
            host: '',
            port: DEFAULT_SMTP_PORT,
            security: 'starttls',
            username: '',
            passwordSet: false,
            fromAddress: '',
            notificationAddress: '',
          },
        },
        instanceHost: HOST,
      });
    });

    it('shows the host from the environment, which settings cannot change', async () => {
      await put({ instance: { timezone: 'Europe/Paris' } });
      expect(await (await get()).json()).toMatchObject({ instanceHost: HOST });
    });
  });

  describe('the instance section', () => {
    it('saves a change and reads it back on a fresh request', async () => {
      const saved = await put({ instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' } });

      expect(saved.status).toBe(200);
      expect(await (await get()).json()).toMatchObject({
        settings: { instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' } },
      });
    });

    it('merges a partial save rather than resetting what it was not sent', async () => {
      await put({ instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' } });
      await put({ instance: { digestTime: '06:15' } });

      expect(await (await get()).json()).toMatchObject({
        settings: { instance: { timezone: 'Asia/Tokyo', digestTime: '06:15' } },
      });
    });

    it('refuses a time zone that is not real and a digest time that is not a time', async () => {
      expect((await put({ instance: { timezone: 'Europe/Atlantis' } })).status).toBe(400);
      for (const digestTime of ['8am', '25:00', '08:60', '8:00']) {
        expect((await put({ instance: { digestTime } })).status, digestTime).toBe(400);
      }
    });

    it('leaves the stored settings untouched when a save is refused', async () => {
      await put({ instance: { timezone: 'Asia/Tokyo' } });
      await put({ instance: { timezone: 'Europe/Atlantis' } });

      expect(await (await get()).json()).toMatchObject({
        settings: { instance: { timezone: 'Asia/Tokyo' } },
      });
    });
  });

  describe('the email section', () => {
    it('saves the SMTP settings and reads them back', async () => {
      const res = await put({ email: { ...CONFIGURED, port: 2525, security: 'tls' } });

      expect(res.status).toBe(200);
      expect(await (await get()).json()).toMatchObject({
        settings: {
          email: { host: 'smtp.example.com', port: 2525, security: 'tls' },
        },
      });
    });

    it('never answers with the password, only whether there is one', async () => {
      const res = await put({ email: { ...CONFIGURED, password: 'hunter2' } });
      const body = await res.text();

      expect(body).not.toContain('hunter2');
      expect(body).not.toContain('enc:v1:');
      expect(JSON.parse(body).settings.email).not.toHaveProperty('password');
      expect(JSON.parse(body).settings.email.passwordSet).toBe(true);
    });

    it('stores the password encrypted, not as it was typed', async () => {
      await put({ email: { ...CONFIGURED, password: 'hunter2' } });

      const stored = (await readSettings(db)).email.password;
      expect(stored).not.toBe('hunter2');
      expect(isEncrypted(stored)).toBe(true);
    });

    it('keeps the password when a later save leaves it out', async () => {
      await put({ email: { ...CONFIGURED, password: 'hunter2' } });
      const before = (await readSettings(db)).email.password;

      await put({ email: { host: 'smtp.elsewhere.com' } });

      const after = await readSettings(db);
      expect(after.email.host).toBe('smtp.elsewhere.com');
      expect(after.email.password).toBe(before);
      expect(await (await get()).json()).toMatchObject({
        settings: { email: { passwordSet: true } },
      });
    });

    it('refuses an address that is not one', async () => {
      expect((await put({ email: { fromAddress: 'not-an-address' } })).status).toBe(400);
      expect((await put({ email: { notificationAddress: 'also-not' } })).status).toBe(400);
    });

    it('refuses a port outside the range', async () => {
      expect((await put({ email: { port: 0 } })).status).toBe(400);
      expect((await put({ email: { port: 70000 } })).status).toBe(400);
    });
  });

  describe('the test send', () => {
    it('needs a session', async () => {
      expect((await app.request('/api/settings/email/test', { method: 'POST' })).status).toBe(403);
    });

    it('says what is missing rather than failing obscurely', async () => {
      const res = await test_send();

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: {
          code: 'email_not_configured',
          message: 'Set the SMTP host, from address and notification address first.',
        },
      });
    });

    it('reports the error verbatim when the server cannot be reached', async () => {
      await put({ email: { ...CONFIGURED, host: '127.0.0.1', port: 1, security: 'none' } });

      const res = await test_send();

      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('smtp_failed');
      expect(body.error.message).toMatch(/ECONNREFUSED|connect/i);
    });

    it.skipIf(!smtpUrl)('delivers to Mailpit and says where it went', async () => {
      await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
      const url = new URL(smtpUrl as string);
      await put({
        email: {
          ...CONFIGURED,
          host: url.hostname,
          port: Number(url.port),
          security: 'none',
        },
      });

      const res = await test_send();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sentTo: CONFIGURED.notificationAddress });

      const inbox = (await (await fetch(`${mailpitUrl}/api/v1/messages`)).json()) as {
        messages: { Subject: string; To: { Address: string }[] }[];
      };
      expect(inbox.messages).toHaveLength(1);
      expect(inbox.messages[0]?.Subject).toBe('Goodies Beacon test email');
      expect(inbox.messages[0]?.To[0]?.Address).toBe(CONFIGURED.notificationAddress);
      await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
    });

    it('takes no address, so it cannot be told to mail a stranger', async () => {
      await put({ email: CONFIGURED });

      const res = await app.request('/api/settings/email/test', {
        method: 'POST',
        headers: { cookie, [CSRF_HEADER]: csrf, 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'someone-else@example.com' }),
      });

      // The body is ignored; the attempt goes to the configured address and fails to connect.
      expect(res.status).toBe(502);
    });
  });
});
