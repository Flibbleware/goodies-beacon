import {
  AuthUserExistsError,
  changePasswordSchema,
  createAuthUser,
  createSession,
  type Database,
  deleteOtherSessions,
  deleteSession,
  findAuthUser,
  firstRunSchema,
  type Logger,
  loadSession,
  loginSchema,
  USER_ID,
  updatePassword,
  verifyPassword,
} from '@goodies-beacon/core';
import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';
import { clearSessionCookie, SESSION_COOKIE, setCsrfCookie, setSessionCookie } from './cookies.js';
import { createCsrfToken } from './csrf.js';
import { type AuthVariables, requireSession } from './guard.js';
import { clientKey, type LoginRateLimiter } from './rate-limit.js';

export interface AuthRouteDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly rateLimiter: LoginRateLimiter;
}

type AuthContext = Context<{ Variables: AuthVariables }>;

/**
 * `/api/auth`. Everything here answers without a session except the password change, which guards
 * itself — the rest are how a session is obtained in the first place.
 */
export function createAuthRoutes({ db, logger, rateLimiter }: AuthRouteDeps) {
  const routes = new Hono<{ Variables: AuthVariables }>();

  routes.get('/session', async (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    const session = id ? await loadSession(db, id) : undefined;
    const user = await findAuthUser(db);
    return c.json({ authenticated: session !== undefined, firstRun: user === undefined });
  });

  routes.post('/first-run', async (c) => {
    const body = await parseBody(c, firstRunSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    try {
      const user = await createAuthUser(db, body.value.password);
      await startSession(c, db, user.id);
      logger.info('first-run password set', { ip: clientOf(c) });
      return c.json({ authenticated: true }, 201);
    } catch (error) {
      if (error instanceof AuthUserExistsError) {
        return errorResponse(c, 409, 'already_initialised', 'A password has already been set.');
      }
      throw error;
    }
  });

  routes.post('/login', async (c) => {
    const key = clientOf(c);
    const limit = rateLimiter.check(key);
    if (!limit.allowed) {
      logger.warn('login refused: rate limited', { ip: key });
      c.header('Retry-After', String(limit.retryAfterSeconds));
      const message = 'Too many failed sign-in attempts. Try again later.';
      return errorResponse(c, 429, 'rate_limited', message);
    }

    const body = await parseBody(c, loginSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    const user = await findAuthUser(db);
    if (!user) return errorResponse(c, 409, 'not_initialised', 'No password has been set yet.');

    if (!(await verifyPassword(user.passwordHash, body.value.password))) {
      rateLimiter.recordFailure(key);
      logger.warn('login failed', { ip: key });
      return errorResponse(c, 401, 'invalid_credentials', 'That password is not correct.');
    }

    rateLimiter.clear(key);
    // Rotated, not reused (§12): any session id the client arrived with is discarded.
    const arrivedWith = getCookie(c, SESSION_COOKIE);
    if (arrivedWith) await deleteSession(db, arrivedWith);
    await startSession(c, db, user.id);
    logger.info('login succeeded', { ip: key });
    return c.json({ authenticated: true });
  });

  routes.post('/logout', async (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) await deleteSession(db, id);
    clearSessionCookie(c);
    // The CSRF token is replaced rather than dropped: signing back in is itself a POST, and it
    // needs a token to echo. Nothing about the token was tied to the session that just ended.
    setCsrfCookie(c, createCsrfToken());
    return c.body(null, 204);
  });

  routes.post('/password', requireSession(db), async (c) => {
    const body = await parseBody(c, changePasswordSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    const user = await findAuthUser(db);
    if (!user) return errorResponse(c, 409, 'not_initialised', 'No password has been set yet.');

    if (!(await verifyPassword(user.passwordHash, body.value.currentPassword))) {
      logger.warn('password change failed: wrong current password', { ip: clientOf(c) });
      const message = 'Your current password is not correct.';
      return errorResponse(c, 401, 'invalid_credentials', message);
    }

    await updatePassword(db, body.value.newPassword);
    // A new password ends every session but the one making the change, including any an
    // attacker holds — which is the point of changing it.
    const id = await startSession(c, db, USER_ID);
    await deleteOtherSessions(db, USER_ID, id);
    logger.info('password changed', { ip: clientOf(c) });
    return c.json({ authenticated: true });
  });

  return routes;
}

/** Issues a fresh session with its cookies and returns its id. */
async function startSession(c: AuthContext, db: Database, userId: number): Promise<string> {
  const session = await createSession(db, userId);
  setSessionCookie(c, session.id);
  setCsrfCookie(c, createCsrfToken());
  return session.id;
}

function clientOf(c: AuthContext): string {
  return clientKey(c.req.header('x-forwarded-for'));
}
