import { describe, expect, it } from 'vitest';
import { parseSetCookie } from './cookies.js';

const NOW = new Date('2026-09-13T12:00:00.000Z');

describe('parseSetCookie', () => {
  it('reads a plain name and value', () => {
    expect(parseSetCookie('datadome=abc123', NOW)).toEqual({
      name: 'datadome',
      value: 'abc123',
      path: '/',
      expiresAt: null,
    });
  });

  it('keeps a value containing an equals sign, which base64 cookies do', () => {
    expect(parseSetCookie('session=YWJjPT0=; Path=/', NOW)?.value).toBe('YWJjPT0=');
  });

  it('reads Max-Age as an offset from now', () => {
    expect(parseSetCookie('a=b; Max-Age=3600', NOW)?.expiresAt).toEqual(
      new Date('2026-09-13T13:00:00.000Z'),
    );
  });

  it('reads an Expires date', () => {
    expect(parseSetCookie('a=b; Expires=Sun, 14 Sep 2026 12:00:00 GMT', NOW)?.expiresAt).toEqual(
      new Date('2026-09-14T12:00:00.000Z'),
    );
  });

  it('prefers Max-Age over Expires, as RFC 6265 requires', () => {
    const cookie = parseSetCookie('a=b; Max-Age=60; Expires=Sun, 14 Sep 2026 12:00:00 GMT', NOW);

    expect(cookie?.expiresAt).toEqual(new Date('2026-09-13T12:01:00.000Z'));
  });

  it('records a non-default path', () => {
    expect(parseSetCookie('a=b; Path=/catalog', NOW)?.path).toBe('/catalog');
  });

  it('treats a past expiry as a deletion rather than storing an empty session', () => {
    expect(parseSetCookie('a=; Expires=Thu, 01 Jan 1970 00:00:00 GMT', NOW)).toBeNull();
    expect(parseSetCookie('a=b; Max-Age=0', NOW)).toBeNull();
  });

  it('ignores a line it cannot parse rather than storing rubbish', () => {
    expect(parseSetCookie('', NOW)).toBeNull();
    expect(parseSetCookie('novalue', NOW)).toBeNull();
    expect(parseSetCookie('=orphan', NOW)).toBeNull();
  });

  it('ignores attributes it has no use for', () => {
    const cookie = parseSetCookie('a=b; Secure; HttpOnly; SameSite=Lax; Domain=.vinted.co.uk', NOW);

    expect(cookie).toEqual({ name: 'a', value: 'b', path: '/', expiresAt: null });
  });
});
