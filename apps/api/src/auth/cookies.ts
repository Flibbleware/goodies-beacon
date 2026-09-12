import { SESSION_TTL_MS } from '@goodies-beacon/core';
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'gb_session';

/** Readable by the web app, which echoes it back in CSRF_HEADER (§12 double-submit). */
export const CSRF_COOKIE = 'gb_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * `Secure` is unconditional: browsers treat localhost as a secure context, so a development
 * instance over plain HTTP still gets the cookie, and nothing else should be served over HTTP.
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
