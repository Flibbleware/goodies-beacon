import type { Database, Logger } from '@goodies-beacon/core';
import { Hono } from 'hono';
import { csrf } from './auth/csrf.js';
import { type AuthVariables, requireSession } from './auth/guard.js';
import { createLoginRateLimiter, type LoginRateLimiter } from './auth/rate-limit.js';
import { createAuthRoutes } from './auth/routes.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { createHealthRoute } from './health.js';
import { type RequestVariables, requestId } from './request-id.js';
import { createSettingsRoutes } from './settings/routes.js';
import { serveWebApp } from './web.js';

export type AppVariables = AuthVariables & RequestVariables;

export interface AppDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly host: string;
  readonly version: string;
  readonly sha: string;
  /** Injected by tests that need to drive the clock or inspect the counters. */
  readonly rateLimiter?: LoginRateLimiter;
  /** Where the built web app lives, or absent not to serve it — development leaves that to Vite. */
  readonly webRoot?: string | undefined;
}

/** Build the Hono application. Kept separate from main.ts so tests can mount it without listening. */
export function createApp(deps: AppDeps) {
  const { db, logger, host, version, sha, rateLimiter, webRoot } = deps;
  const app = new Hono<{ Variables: AppVariables }>();

  app.onError(errorHandler(logger));
  app.notFound(notFoundHandler());

  app.use('*', requestId(logger));

  app.route('/healthz', createHealthRoute({ db, version, sha }));

  app.use('/api/*', csrf());
  app.route(
    '/api/auth',
    createAuthRoutes({ db, logger, rateLimiter: rateLimiter ?? createLoginRateLimiter() }),
  );

  // After the auth routes, which have already answered by the time this is reached, so it guards
  // every other /api path — including ones that do not exist.
  app.use('/api/*', requireSession(db));
  app.route('/api/settings', createSettingsRoutes({ db, host }));

  // The API's own 404, before the web app's catch-all: an unknown /api path is a mistake worth a
  // JSON error, not a page.
  app.all('/api/*', notFoundHandler());

  if (webRoot !== undefined) serveWebApp(app, webRoot);

  return app;
}
