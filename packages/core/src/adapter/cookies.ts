import { and, eq, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sourceCookies } from '../db/schema.js';
import type { SourceId } from '../sources.js';
import type { CookieJar } from './types.js';

/**
 * A cookie jar backed by the database, so a session survives a restart (§5).
 *
 * Deliberately not a full RFC 6265 implementation: adapters talk to one host each, over HTTPS,
 * and need the session back after a restart. So this stores what `set-cookie` gave it, honours
 * expiry, and leaves domain matching to the caller naming the domain it is talking to. Anything
 * cleverer would be untested cleverness in the path that decides whether Vinted answers at all.
 */

/** Parses one `set-cookie` value. Returns null for a deletion or an unparseable line. */
export function parseSetCookie(
  header: string,
  now: Date = new Date(),
): { name: string; value: string; path: string; expiresAt: Date | null } | null {
  const [pair, ...attributes] = header.split(';');
  const eq = pair?.indexOf('=') ?? -1;
  if (!pair || eq <= 0) return null;

  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;

  let expiresAt: Date | null = null;
  let path = '/';
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey?.trim().toLowerCase();
    const raw = rest.join('=').trim();
    if (key === 'max-age') {
      const seconds = Number.parseInt(raw, 10);
      if (Number.isFinite(seconds)) expiresAt = new Date(now.getTime() + seconds * 1000);
    } else if (key === 'expires' && expiresAt === null) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) expiresAt = parsed;
    } else if (key === 'path' && raw) {
      path = raw;
    }
  }

  // A server clearing a cookie sends an empty value and a past expiry; storing it would be
  // storing the absence of a session and then sending it back.
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) return null;

  return { name, value, path, expiresAt };
}

export function createCookieJar(
  db: Database,
  source: SourceId,
  now: () => Date = () => new Date(),
): CookieJar {
  return {
    async header(domain) {
      // Expired rows are pruned on read rather than only on write: a worker that stored a cookie
      // and then sat idle overnight must not send a stale one when it wakes. A null `expires_at`
      // is a session cookie and never matches `lt`, so it survives, which is what Vinted needs.
      await db
        .delete(sourceCookies)
        .where(and(eq(sourceCookies.source, source), lt(sourceCookies.expiresAt, now())));

      const rows = await db
        .select({ name: sourceCookies.name, value: sourceCookies.value })
        .from(sourceCookies)
        .where(and(eq(sourceCookies.source, source), eq(sourceCookies.domain, domain)));

      if (rows.length === 0) return null;
      return rows.map((row) => `${row.name}=${row.value}`).join('; ');
    },

    async store(domain, setCookie) {
      const at = now();
      const parsed = setCookie
        .map((header) => parseSetCookie(header, at))
        .filter((cookie): cookie is NonNullable<typeof cookie> => cookie !== null);

      if (parsed.length === 0) return;

      for (const cookie of parsed) {
        await db
          .insert(sourceCookies)
          .values({
            source,
            domain,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path,
            expiresAt: cookie.expiresAt,
          })
          .onConflictDoUpdate({
            target: [sourceCookies.source, sourceCookies.domain, sourceCookies.name],
            set: {
              value: cookie.value,
              path: cookie.path,
              expiresAt: cookie.expiresAt,
              updatedAt: at,
            },
          });
      }
    },

    async clear(domain) {
      await db
        .delete(sourceCookies)
        .where(
          domain
            ? and(eq(sourceCookies.source, source), eq(sourceCookies.domain, domain))
            : eq(sourceCookies.source, source),
        );
    },
  };
}

/**
 * A jar that forgets everything when the process ends. For the fixture harness and for a health
 * check that must not write to the database; anything polling for real wants `createCookieJar`.
 */
export function createMemoryCookieJar(now: () => Date = () => new Date()): CookieJar {
  const byDomain = new Map<string, Map<string, { value: string; expiresAt: Date | null }>>();

  return {
    async header(domain) {
      const at = now();
      const cookies = byDomain.get(domain);
      if (!cookies) return null;

      for (const [name, cookie] of cookies) {
        if (cookie.expiresAt && cookie.expiresAt.getTime() <= at.getTime()) cookies.delete(name);
      }
      if (cookies.size === 0) return null;

      return [...cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
    },

    async store(domain, setCookie) {
      const at = now();
      const cookies = byDomain.get(domain) ?? new Map();
      byDomain.set(domain, cookies);

      for (const header of setCookie) {
        const parsed = parseSetCookie(header, at);
        if (parsed) cookies.set(parsed.name, { value: parsed.value, expiresAt: parsed.expiresAt });
      }
    },

    async clear(domain) {
      if (domain) byDomain.delete(domain);
      else byDomain.clear();
    },
  };
}
