import { type AuthSession, type Database, loadSession } from '@goodies-beacon/core';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { errorResponse } from '../errors.js';
import { clearSessionCookie, SESSION_COOKIE } from './cookies.js';

export interface AuthVariables {
  session: AuthSession;
}

/**
 * Refuses a request that has no live session. Mounted on `/api/*` after the public auth routes,
 * so it guards everything they did not already answer — including paths that do not exist, which
 * keeps the route list from being enumerable before sign-in. `/healthz` sits outside `/api` so a
 * monitor can reach it.
 */
export function requireSession(db: Database): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const id = getCookie(c, SESSION_COOKIE);
    const session = id ? await loadSession(db, id) : undefined;

    if (!session) {
      // A cookie that no longer resolves is stale; clearing it stops the browser resending it.
      if (id) clearSessionCookie(c);
      return errorResponse(c, 401, 'unauthorized', 'Sign in to use this endpoint.');
    }

    c.set('session', session);
    return next();
  };
}
