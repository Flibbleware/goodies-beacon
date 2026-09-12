import { type Database, type Logger, PING_TIMEOUT_MS } from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, child: () => logger };

function appWith(execute: () => Promise<unknown>) {
  return createApp({
    db: { execute } as unknown as Database,
    logger,
    host: 'beacon.example.co.uk',
    version: '1.2.3',
    sha: 'abc1234',
  });
}

describe('GET /healthz', () => {
  it('reports the build it is running and that the database answers', async () => {
    const res = await appWith(async () => [{ '?column?': 1 }]).request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      version: '1.2.3',
      sha: 'abc1234',
      db: 'ok',
    });
  });

  it('answers 503 when the database cannot be reached, so a deploy fails rather than passes', async () => {
    const res = await appWith(() => Promise.reject(new Error('ECONNREFUSED'))).request('/healthz');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'error',
      version: '1.2.3',
      sha: 'abc1234',
      db: 'unreachable',
    });
  });

  it('does not leak why the database was unreachable', async () => {
    const res = await appWith(() =>
      Promise.reject(new Error('password authentication failed for user "goodies_beacon"')),
    ).request('/healthz');

    expect(await res.text()).not.toContain('password');
  });

  it('needs no session, so a monitor can reach it', async () => {
    const res = await appWith(async () => []).request('/healthz');
    expect(res.status).not.toBe(401);
  });

  it('answers 503 rather than hanging when the database accepts but never replies', async () => {
    // A paused container behaves exactly like this: the socket stays open and nothing comes back.
    const app = appWith(() => new Promise(() => {}));

    const started = performance.now();
    const res = await app.request('/healthz');

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ db: 'unreachable' });
    expect(performance.now() - started).toBeLessThan(PING_TIMEOUT_MS * 3);
  }, 15_000);
});
