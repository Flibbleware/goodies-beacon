import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { authSession, authUser } from '../db/schema.js';
import {
  createSession,
  createSessionToken,
  deleteOtherSessions,
  deleteSession,
  hashSessionToken,
  loadSession,
  SESSION_ID_BYTES,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
} from './session.js';
import { USER_ID } from './user.js';

/**
 * Driven by TEST_DATABASE_URL like the other integration tests: CI's Tests job runs a Postgres
 * service. Sliding expiry is a property of what the row says, so a fake store would prove nothing.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
let pool: Pool | undefined;
let db: Database;

const NOW = new Date('2026-09-12T10:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!databaseUrl)('sessions against a real Postgres', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(authSession);
    await db.delete(authUser);
    await db.insert(authUser).values({ id: USER_ID, passwordHash: 'not-verified-here' });
  });

  it('mints a 256-bit token and a thirty-day expiry', async () => {
    const { token, session } = await createSession(db, USER_ID, NOW);

    expect(Buffer.from(token, 'base64url')).toHaveLength(SESSION_ID_BYTES);
    expect(session.expiresAt.getTime()).toBe(NOW.getTime() + SESSION_TTL_MS);
  });

  it('gives out tokens that never repeat', () => {
    expect(new Set(Array.from({ length: 100 }, createSessionToken)).size).toBe(100);
  });

  it('stores only a hash of the token, so a copy of the table cannot be replayed', async () => {
    const { token, session } = await createSession(db, USER_ID, NOW);

    expect(session.id).toBe(hashSessionToken(token));
    expect(session.id).not.toBe(token);
    // What the table holds is useless as a cookie value.
    expect(await loadSession(db, session.id, NOW)).toBeUndefined();
    expect(await loadSession(db, token, NOW)).toBeDefined();
  });

  it('does not resolve a token it never issued', async () => {
    expect(await loadSession(db, createSessionToken(), NOW)).toBeUndefined();
  });

  it('slides the expiry forward on use, but no more than once an hour', async () => {
    const { token, session } = await createSession(db, USER_ID, NOW);

    const soon = await loadSession(db, token, later(SESSION_REFRESH_AFTER_MS - 1000));
    expect(soon?.expiresAt.getTime()).toBe(session.expiresAt.getTime());

    const useAt = later(SESSION_REFRESH_AFTER_MS + 1000);
    const refreshed = await loadSession(db, token, useAt);
    expect(refreshed?.expiresAt.getTime()).toBe(useAt.getTime() + SESSION_TTL_MS);
    expect(refreshed?.lastUsedAt.getTime()).toBe(useAt.getTime());
  });

  it('sweeps sessions that expired without being presented again when a new one is minted', async () => {
    const stale = await createSession(db, USER_ID, NOW);
    const fresh = await createSession(db, USER_ID, later(SESSION_TTL_MS + 1000));

    const rowsFor = (id: string) => db.select().from(authSession).where(eq(authSession.id, id));
    expect(await rowsFor(stale.session.id)).toEqual([]);
    expect(await rowsFor(fresh.session.id)).toHaveLength(1);
  });

  it('refuses an expired session and deletes the row on the way past', async () => {
    const { token, session } = await createSession(db, USER_ID, NOW);

    expect(await loadSession(db, token, later(SESSION_TTL_MS))).toBeUndefined();
    expect(await db.select().from(authSession).where(eq(authSession.id, session.id))).toEqual([]);
  });

  it('never expires while it keeps being used', async () => {
    const { token } = await createSession(db, USER_ID, NOW);
    const week = 7 * 24 * 60 * 60 * 1000;

    let at = NOW;
    for (let n = 1; n <= 10; n += 1) {
      at = new Date(at.getTime() + week);
      expect(await loadSession(db, token, at), `week ${n}`).toBeDefined();
    }
  });

  it('deletes one session without touching the others', async () => {
    const [a, b] = await Promise.all([
      createSession(db, USER_ID, NOW),
      createSession(db, USER_ID, NOW),
    ]);

    await deleteSession(db, a.token);

    expect(await loadSession(db, a.token, NOW)).toBeUndefined();
    expect(await loadSession(db, b.token, NOW)).toBeDefined();
  });

  it('drops every session but the one named, for a password change', async () => {
    const doomed = await Promise.all([
      createSession(db, USER_ID, NOW),
      createSession(db, USER_ID, NOW),
    ]);
    const keep = await createSession(db, USER_ID, NOW);

    await deleteOtherSessions(db, USER_ID, keep.token);

    for (const { token } of doomed) {
      expect(await loadSession(db, token, NOW)).toBeUndefined();
    }
    expect(await loadSession(db, keep.token, NOW)).toBeDefined();
  });
});
