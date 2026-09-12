import { type Database, type Logger, PACKAGE } from '@goodies-beacon/core';
import { Hono } from 'hono';
import { csrf } from './auth/csrf.js';
import { type AuthVariables, requireSession } from './auth/guard.js';
import { createLoginRateLimiter, type LoginRateLimiter } from './auth/rate-limit.js';
import { createAuthRoutes } from './auth/routes.js';

export interface AppDeps {
  readonly db: Database;
  readonly logger: Logger;
  /** Injected by tests that need to drive the clock or inspect the counters. */
  readonly rateLimiter?: LoginRateLimiter;
}

/** Build the Hono application. Kept separate from main.ts so tests can mount it without listening. */
export function createApp({ db, logger, rateLimiter }: AppDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // P0-08 replaces this with the real health check (database ping, version, git SHA).
  app.get('/healthz', (c) => c.json({ status: 'ok', core: PACKAGE }));

  app.use('/api/*', csrf());
  app.route(
    '/api/auth',
    createAuthRoutes({ db, logger, rateLimiter: rateLimiter ?? createLoginRateLimiter() }),
  );

  // Deliberately after the auth routes, which have already answered by the time this is reached,
  // so it guards every other /api path — including ones that do not exist.
  app.use('/api/*', requireSession(db));

  return app;
}
