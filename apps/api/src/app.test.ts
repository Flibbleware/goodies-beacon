import type { Database, Logger } from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { CSRF_COOKIE, CSRF_HEADER } from './auth/cookies.js';

const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, child: () => logger };

/** These routes answer before touching the database, so a stub keeps them out of Postgres. */
const app = createApp({
  db: { execute: async () => [] } as unknown as Database,
  logger,
  host: 'beacon.example.co.uk',
  version: 'dev',
  sha: 'unknown',
});

/**
 * Any safe request under /api mints a CSRF token. This path has no route, so it answers 401 from
 * the guard — but the token is set on the way past, which is all these tests need.
 */
const MINT = '/api/auth/unrouted';

function csrfFrom(res: Response): string {
  const cookie = res.headers.getSetCookie().find((line) => line.startsWith(`${CSRF_COOKIE}=`));
  return cookie?.split(';')[0]?.split('=')[1] ?? '';
}

describe('GET /healthz', () => {
  it('responds ok without a session, so a monitor can reach it', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('the /api guard', () => {
  it('refuses any /api route without a session', async () => {
    for (const path of ['/api/settings', '/api/items', '/api/does-not-exist']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: 'unauthorized', message: 'Sign in to use this endpoint.' },
      });
    }
  });

  it('leaves the auth routes reachable, since they are how a session is obtained', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST' });
    expect(res.status).not.toBe(401);
  });
});

describe('CSRF', () => {
  it('mints a token on a safe request so the page has one to echo back', async () => {
    const res = await app.request(MINT);
    const cookie = res.headers.getSetCookie().find((line) => line.startsWith(`${CSRF_COOKIE}=`));

    expect(cookie).toBeDefined();
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    // Readable by the web app: a double-submit token the page cannot read is useless.
    expect(cookie).not.toContain('HttpOnly');
  });

  it('refuses a state-changing request with no token', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'csrf_failed' } });
  });

  it('refuses a state-changing request whose header does not match the cookie', async () => {
    const token = csrfFrom(await app.request(MINT));
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: `${token}x` },
    });

    expect(res.status).toBe(403);
  });

  it('accepts a state-changing request whose header matches the cookie', async () => {
    const token = csrfFrom(await app.request(MINT));
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: token },
    });

    expect(res.status).toBe(204);
  });
});
