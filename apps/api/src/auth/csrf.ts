import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { errorResponse } from '../errors.js';
import { CSRF_COOKIE, CSRF_HEADER, setCsrfCookie } from './cookies.js';

const TOKEN_BYTES = 32;

/** Methods that cannot change state, and so need no token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Double-submit CSRF (§12). A safe request mints the cookie if it is missing, so the page always
 * has a token to echo — including before login, which is what makes login itself protected. An
 * unsafe request must send the same value in CSRF_HEADER, which a cross-site form cannot do.
 */
export function csrf(): MiddlewareHandler {
  return async (c, next) => {
    const cookie = getCookie(c, CSRF_COOKIE);

    if (SAFE_METHODS.has(c.req.method)) {
      if (!cookie) setCsrfCookie(c, createCsrfToken());
      return next();
    }

    const header = c.req.header(CSRF_HEADER);
    if (!cookie || !header || !tokensMatch(cookie, header)) {
      return errorResponse(c, 403, 'csrf_failed', 'Missing or mismatched CSRF token.');
    }

    return next();
  };
}

function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
