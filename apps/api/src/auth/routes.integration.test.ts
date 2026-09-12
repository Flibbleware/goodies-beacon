import {
  authSession,
  authUser,
  createDb,
  createPool,
  type Database,
  type Logger,
  loadSession,
  runMigrations,
  SESSION_TTL_MS,
} from '@goodies-beacon/core';
import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './cookies.js';
import { createLoginRateLimiter, MAX_ATTEMPTS, WINDOW_MS } from './rate-limit.js';

/**
 * The whole sign-in flow over real HTTP requests against the Hono app, against a real Postgres
 * (TEST_DATABASE_URL; CI's Tests job provides one). Cookies, session rows and lockout all have to
 * agree with each other, which is only true end to end.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const PASSWORD = 'a-good-enough-password';
const logger: Logger = { error() {}, warn() {}, info() {}, debug() {} };

let pool: Pool | undefined;
let db: Database;
let app: Hono;
let rateLimiter: ReturnType<typeof createLoginRateLimiter>;

afterAll(async () => {
  await pool?.end();
});

/** The cookie jar a browser would keep: the current value of every cookie the app has set. */
function jar(): {
  header(): string;
  take(res: Response): void;
  get(name: string): string | undefined;
} {
  const cookies = new Map<string, string>();

  return {
    header() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    take(res) {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const name = pair?.slice(0, pair.indexOf('=')) ?? '';
        const value = pair?.slice(pair.indexOf('=') + 1) ?? '';
        if (value === '') cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    get(name) {
      return cookies.get(name);
    },
  };
}

function setCookieFor(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

/** A request carrying the jar's cookies and, for unsafe methods, its CSRF token. */
async function send(
  cookies: ReturnType<typeof jar>,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...init.headers,
  };

  const header = cookies.header();
  if (header !== '') headers.cookie = header;

  const token = cookies.get(CSRF_COOKIE);
  if (token && method !== 'GET') headers[CSRF_HEADER] = token;

  const res = await app.request(path, {
    method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  cookies.take(res);
  return res;
}

/** A jar that has been through first-run and so holds a live session. */
async function signedUp(): Promise<ReturnType<typeof jar>> {
  const cookies = jar();
  await send(cookies, '/api/auth/session');
  const res = await send(cookies, '/api/auth/first-run', {
    method: 'POST',
    body: { password: PASSWORD },
  });
  expect(res.status).toBe(201);
  return cookies;
}

describe.skipIf(!databaseUrl)('the auth routes', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(authSession);
    await db.delete(authUser);
    rateLimiter = createLoginRateLimiter();
    app = createApp({ db, logger, rateLimiter });
  });

  describe('first run', () => {
    it('reports that no password is set, then that one is', async () => {
      const cookies = jar();

      const before = await send(cookies, '/api/auth/session');
      expect(await before.json()).toEqual({ authenticated: false, firstRun: true });

      await send(cookies, '/api/auth/first-run', { method: 'POST', body: { password: PASSWORD } });

      const after = await send(cookies, '/api/auth/session');
      expect(await after.json()).toEqual({ authenticated: true, firstRun: false });
    });

    it('sets the session cookie HttpOnly, Secure, SameSite=Lax and scoped to the site', async () => {
      const cookies = jar();
      await send(cookies, '/api/auth/session');
      const res = await send(cookies, '/api/auth/first-run', {
        method: 'POST',
        body: { password: PASSWORD },
      });

      const cookie = setCookieFor(res, SESSION_COOKIE);
      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    });

    it('stores the password as an argon2id hash and never in the clear', async () => {
      await signedUp();

      const [user] = await db.select().from(authUser);
      expect(user?.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(user?.passwordHash).not.toContain(PASSWORD);
    });

    it('refuses to set a second password', async () => {
      const cookies = await signedUp();

      const res = await send(cookies, '/api/auth/first-run', {
        method: 'POST',
        body: { password: 'another-good-password' },
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: 'already_initialised' } });
    });

    it('refuses a password shorter than the minimum', async () => {
      const cookies = jar();
      await send(cookies, '/api/auth/session');

      const res = await send(cookies, '/api/auth/first-run', {
        method: 'POST',
        body: { password: 'short' },
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'validation_failed' } });
    });
  });

  describe('login', () => {
    it('accepts the password and hands back a session', async () => {
      const signedIn = await signedUp();
      await send(signedIn, '/api/auth/logout', { method: 'POST' });

      const res = await send(signedIn, '/api/auth/login', {
        method: 'POST',
        body: { password: PASSWORD },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ authenticated: true });
      expect(signedIn.get(SESSION_COOKIE)).toBeDefined();
    });

    it('says only that the password is wrong, and does not sign in', async () => {
      const cookies = await signedUp();
      await send(cookies, '/api/auth/logout', { method: 'POST' });

      const res = await send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: 'not-the-password' },
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: 'invalid_credentials', message: 'That password is not correct.' },
      });
      expect(setCookieFor(res, SESSION_COOKIE)).toBeUndefined();
    });

    it('rotates the session id, so the one held before signing in stops working', async () => {
      const cookies = await signedUp();
      const before = cookies.get(SESSION_COOKIE) as string;

      await send(cookies, '/api/auth/login', { method: 'POST', body: { password: PASSWORD } });
      const after = cookies.get(SESSION_COOKIE);

      expect(after).not.toBe(before);
      expect(await loadSession(db, before)).toBeUndefined();
      expect(await loadSession(db, after as string)).toBeDefined();
    });

    it('says so plainly when no password has been set yet', async () => {
      const cookies = jar();
      await send(cookies, '/api/auth/session');

      const res = await send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: PASSWORD },
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: 'not_initialised' } });
    });
  });

  describe('rate limiting', () => {
    async function failLogin(cookies: ReturnType<typeof jar>): Promise<Response> {
      return send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: 'not-the-password' },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
    }

    it('locks the client out after the fifth failure and says for how long', async () => {
      const cookies = await signedUp();

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        expect((await failLogin(cookies)).status, `attempt ${attempt}`).toBe(401);
      }

      const locked = await failLogin(cookies);
      expect(locked.status).toBe(429);
      expect(await locked.json()).toMatchObject({ error: { code: 'rate_limited' } });
      expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(Number(locked.headers.get('Retry-After'))).toBeLessThanOrEqual(WINDOW_MS / 1000);
    });

    it('refuses the right password too while the lockout stands', async () => {
      const cookies = await signedUp();
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) await failLogin(cookies);

      const res = await send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: PASSWORD },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });

      expect(res.status).toBe(429);
    });

    it('counts per client, so one attacker cannot lock the owner out', async () => {
      const cookies = await signedUp();
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) await failLogin(cookies);

      const res = await send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: PASSWORD },
        headers: { 'x-forwarded-for': '198.51.100.4' },
      });

      expect(res.status).toBe(200);
    });

    it('forgets the failures once the password is accepted', async () => {
      const cookies = await signedUp();
      for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) await failLogin(cookies);

      await send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: PASSWORD },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });

      expect(rateLimiter.check('203.0.113.9').allowed).toBe(true);
    });
  });

  describe('the /api guard', () => {
    it('lets a request through once it carries a live session', async () => {
      const cookies = await signedUp();

      // Nothing is mounted here yet, so 404 is the proof the guard did not answer first.
      const res = await send(cookies, '/api/settings');
      expect(res.status).toBe(404);
    });

    it('refuses a session id that was never issued, and clears the stale cookie', async () => {
      await signedUp();
      const cookies = jar();
      await send(cookies, '/api/auth/session');

      const res = await app.request('/api/settings', {
        headers: { cookie: `${SESSION_COOKIE}=not-a-real-session` },
      });

      expect(res.status).toBe(401);
      expect(setCookieFor(res, SESSION_COOKIE)).toContain('Max-Age=0');
    });
  });

  describe('logout', () => {
    it('deletes the session, clears the cookies and cannot be replayed', async () => {
      const cookies = await signedUp();
      const id = cookies.get(SESSION_COOKIE) as string;

      const res = await send(cookies, '/api/auth/logout', { method: 'POST' });

      expect(res.status).toBe(204);
      expect(setCookieFor(res, SESSION_COOKIE)).toContain('Max-Age=0');
      expect(await loadSession(db, id)).toBeUndefined();

      const replayed = await app.request('/api/settings', {
        headers: { cookie: `${SESSION_COOKIE}=${id}` },
      });
      expect(replayed.status).toBe(401);
    });

    it('is harmless when nobody is signed in', async () => {
      const cookies = jar();
      await send(cookies, '/api/auth/session');

      expect((await send(cookies, '/api/auth/logout', { method: 'POST' })).status).toBe(204);
    });
  });

  describe('password change', () => {
    it('needs a session', async () => {
      await signedUp();
      const cookies = jar();
      await send(cookies, '/api/auth/session');

      const res = await send(cookies, '/api/auth/password', {
        method: 'POST',
        body: { currentPassword: PASSWORD, newPassword: 'a-new-good-password' },
      });

      expect(res.status).toBe(401);
    });

    it('changes the password, and the new one is what logs in afterwards', async () => {
      const cookies = await signedUp();

      const res = await send(cookies, '/api/auth/password', {
        method: 'POST',
        body: { currentPassword: PASSWORD, newPassword: 'a-new-good-password' },
      });
      expect(res.status).toBe(200);

      await send(cookies, '/api/auth/logout', { method: 'POST' });
      const withOld = await send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: PASSWORD },
      });
      expect(withOld.status).toBe(401);

      const withNew = await send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: 'a-new-good-password' },
      });
      expect(withNew.status).toBe(200);
    });

    it('refuses a wrong current password and leaves the old one working', async () => {
      const cookies = await signedUp();

      const res = await send(cookies, '/api/auth/password', {
        method: 'POST',
        body: { currentPassword: 'not-the-password', newPassword: 'a-new-good-password' },
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: 'invalid_credentials' } });

      await send(cookies, '/api/auth/logout', { method: 'POST' });
      const stillWorks = await send(cookies, '/api/auth/login', {
        method: 'POST',
        body: { password: PASSWORD },
      });
      expect(stillWorks.status).toBe(200);
    });

    it('ends every other session, including one an attacker holds', async () => {
      const owner = await signedUp();
      const attacker = jar();
      await send(attacker, '/api/auth/session');
      await send(attacker, '/api/auth/login', { method: 'POST', body: { password: PASSWORD } });
      const stolen = attacker.get(SESSION_COOKIE) as string;

      await send(owner, '/api/auth/password', {
        method: 'POST',
        body: { currentPassword: PASSWORD, newPassword: 'a-new-good-password' },
      });

      expect(await loadSession(db, stolen)).toBeUndefined();
      expect((await send(owner, '/api/settings')).status).toBe(404);
    });

    it('refuses a new password shorter than the minimum', async () => {
      const cookies = await signedUp();

      const res = await send(cookies, '/api/auth/password', {
        method: 'POST',
        body: { currentPassword: PASSWORD, newPassword: 'short' },
      });

      expect(res.status).toBe(400);
    });
  });
});
