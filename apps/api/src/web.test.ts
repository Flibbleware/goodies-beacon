import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database, Logger } from '@goodies-beacon/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, child: () => logger };

const INDEX = '<!doctype html><title>Goodies Beacon</title><div id="root"></div>';
const SCRIPT = 'console.log("the app");';

let webRoot: string;
let app: ReturnType<typeof createApp>;

/**
 * A stand-in for apps/web/dist, so these run without the web app having been built — the shapes
 * that matter are "a real file" and "anything else", not React's output.
 */
beforeAll(() => {
  webRoot = mkdtempSync(join(tmpdir(), 'gb-web-'));
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'index.html'), INDEX);
  writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), SCRIPT);

  app = createApp({
    db: { execute: async () => [] } as unknown as Database,
    logger,
    config: {
      host: 'beacon.example.co.uk',
      secretKey: 'IqQ8Xn1rWQhTsm9gOZ4vKdLpEbYxAcRuNjFkHt2SwVo=',
      version: 'dev',
      sha: 'unknown',
    },
    webRoot,
  });
});

afterAll(() => {
  rmSync(webRoot, { recursive: true, force: true });
});

describe('serving the built web app', () => {
  it('serves the app at the root', async () => {
    const res = await app.request('/');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe(INDEX);
  });

  it('serves a hashed asset with its own content type', async () => {
    const res = await app.request('/assets/index-abc123.js');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toBe(SCRIPT);
  });

  it('answers a deep link with the app, so a refresh on /settings works', async () => {
    for (const path of ['/settings', '/items/42', '/a/deep/route']) {
      const res = await app.request(path);

      expect(res.status, path).toBe(200);
      expect(await res.text()).toBe(INDEX);
    }
  });

  it('never lets an API path reach the fallback', async () => {
    const res = await app.request('/api/nope');

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('keeps answering /healthz itself rather than serving the page', async () => {
    const res = await app.request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('refuses to walk out of the web root', async () => {
    const res = await app.request('/../package.json');

    expect(await res.text()).toBe(INDEX);
  });
});
