import { PACKAGE } from '@goodies-beacon/core';
import { Hono } from 'hono';

/** Build the Hono application. Kept separate from main.ts so tests can mount it without listening. */
export function createApp() {
  const app = new Hono();

  // P0-08 replaces this with the real health check (database ping, version, git SHA).
  app.get('/healthz', (c) => c.json({ status: 'ok', core: PACKAGE }));

  return app;
}
