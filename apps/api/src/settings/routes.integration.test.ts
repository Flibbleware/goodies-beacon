import {
  authSession,
  authUser,
  createDb,
  createPool,
  type Database,
  DEFAULT_DIGEST_TIME,
  DEFAULT_TIMEZONE,
  type Logger,
  runMigrations,
  settings,
} from '@goodies-beacon/core';
import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../auth/cookies.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const PASSWORD = 'a-good-enough-password';
const HOST = 'beacon.example.co.uk';
const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, child: () => logger };

let pool: Pool | undefined;
let db: Database;
let app: Hono;
let cookie: string;
let csrf: string;

afterAll(async () => {
  await pool?.end();
});

async function get(path: string): Promise<Response> {
  return app.request(path, { headers: { cookie } });
}

async function put(body: unknown): Promise<Response> {
  return app.request('/api/settings', {
    method: 'PUT',
    headers: { cookie, [CSRF_HEADER]: csrf, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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
    app = createApp({ db, logger, host: HOST, version: 'dev', sha: 'unknown' });

    // Sign in, since /api/settings is behind the guard.
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

  it('needs a session', async () => {
    expect((await app.request('/api/settings')).status).toBe(401);
  });

  it('answers with the defaults before anything has been saved', async () => {
    const res = await get('/api/settings');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { instance: { timezone: DEFAULT_TIMEZONE, digestTime: DEFAULT_DIGEST_TIME } },
      instanceHost: HOST,
    });
  });

  it('shows the host from the environment, which settings cannot change', async () => {
    await put({ instance: { timezone: 'Europe/Paris' } });

    expect(await (await get('/api/settings')).json()).toMatchObject({ instanceHost: HOST });
  });

  it('saves a change and reads it back on a fresh request', async () => {
    const saved = await put({ instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' } });

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      settings: { instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' } },
    });
    expect(await (await get('/api/settings')).json()).toMatchObject({
      settings: { instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' } },
    });
  });

  it('merges a partial save rather than resetting what it was not sent', async () => {
    await put({ instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' } });
    await put({ instance: { digestTime: '06:15' } });

    expect(await (await get('/api/settings')).json()).toMatchObject({
      settings: { instance: { timezone: 'Asia/Tokyo', digestTime: '06:15' } },
    });
  });

  it('refuses a time zone that is not real, so the digest cannot be scheduled into nowhere', async () => {
    const res = await put({ instance: { timezone: 'Europe/Atlantis' } });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('refuses a digest time that is not a 24-hour clock time', async () => {
    for (const digestTime of ['8am', '25:00', '08:60', '8:00']) {
      expect((await put({ instance: { digestTime } })).status, digestTime).toBe(400);
    }
  });

  it('leaves the stored settings untouched when a save is refused', async () => {
    await put({ instance: { timezone: 'Asia/Tokyo' } });
    await put({ instance: { timezone: 'Europe/Atlantis' } });

    expect(await (await get('/api/settings')).json()).toMatchObject({
      settings: { instance: { timezone: 'Asia/Tokyo' } },
    });
  });

  it('needs a CSRF token to save', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ instance: { timezone: 'Asia/Tokyo' } }),
    });

    expect(res.status).toBe(403);
  });
});

describe.skipIf(!databaseUrl)('GET /healthz against a real database', () => {
  it('reports the database as ok', async () => {
    const url = databaseUrl as string;
    const health = createApp({
      db: createDb(pool ?? createPool(url)),
      logger,
      host: HOST,
      version: '0.1.0',
      sha: 'deadbee',
    });

    const res = await health.request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      version: '0.1.0',
      sha: 'deadbee',
      db: 'ok',
    });
  });
});

function cookieValue(res: Response, name: string): string | undefined {
  const line = res.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  const pair = line?.split(';')[0];
  return pair?.slice(pair.indexOf('=') + 1);
}
