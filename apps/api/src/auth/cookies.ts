import { SESSION_TTL_MS } from '@goodies-beacon/core';
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'gb_session';

/** Readable by the web app, which echoes it back in CSRF_HEADER (§12 double-submit). */
export const CSRF_COOKIE = 'gb_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * `Secure` is unconditional. Browsers treat localhost as a secure context and keep a `Secure`
 * cookie set over plain HTTP there, so development and the Playwright run need no TLS — that run
 * is what proves it, since it signs in and stays signed in over `http://localhost`. Anywhere
 * else, HTTP would drop the cookie, which is the intended outcome.
 */
const BASE = { path: '/', secure: true, sameSite: 'Lax' } as const;

export function setSessionCookie(c: Context, id: string): void {
  setCookie(c, SESSION_COOKIE, id, {
    ...BASE,
    httpOnly: true,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Not HttpOnly: the point of a double-submit token is that the page can read it and send it back. */
export function setCsrfCookie(c: Context, token: string): void {
  setCookie(c, CSRF_COOKIE, token, { ...BASE, httpOnly: false });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, BASE);
}
