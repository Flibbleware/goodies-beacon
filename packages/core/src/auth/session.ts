import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt, ne } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { type AuthSession, authSession } from '../db/schema.js';

/** 256 bits, base64url so it survives a cookie value unencoded. */
export const SESSION_ID_BYTES = 32;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The expiry slides on use, but only once an hour: an open tab polling the API should not write
 * a row on every request to move an expiry that is thirty days out.
 */
export const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;

/** What the cookie carries. The table never holds it — see `hashSessionToken`. */
export function createSessionToken(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url');
}

/**
 * The row's id is the SHA-256 of the token, so a copy of the table — a backup, a dump on a
 * laptop — cannot be replayed as a session. The token has 256 bits of entropy, so a plain hash
 * is enough; there is nothing to brute-force and no salt to keep.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export interface IssuedSession {
  /** Goes in the cookie, and nowhere else. */
  readonly token: string;
  readonly session: AuthSession;
}

export async function createSession(
  db: Database,
  userId: number,
  now = new Date(),
): Promise<IssuedSession> {
  // A session that expires without ever being presented again is never deleted by loadSession,
  // so the table would grow by one row per sign-in for ever. A sign-in is rare enough to sweep on.
  await db.delete(authSession).where(lt(authSession.expiresAt, now));

  const token = createSessionToken();
  const [created] = await db
    .insert(authSession)
    .values({
      id: hashSessionToken(token),
      userId,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .returning();

  // The insert either returns its row or throws; this keeps the type honest.
  if (!created) throw new Error('session insert returned no row');
  return { token, session: created };
}

/**
 * The session for this token, or undefined if there is none or it has expired. An expired row is
 * deleted on the way past, so a cookie left behind by a closed laptop cleans itself up.
 */
export async function loadSession(
  db: Database,
  token: string,
  now = new Date(),
): Promise<AuthSession | undefined> {
  const id = hashSessionToken(token);
  const [session] = await db.select().from(authSession).where(eq(authSession.id, id));
  if (!session) return undefined;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await db.delete(authSession).where(eq(authSession.id, id));
    return undefined;
  }

  if (now.getTime() - session.lastUsedAt.getTime() < SESSION_REFRESH_AFTER_MS) return session;

  const [refreshed] = await db
    .update(authSession)
    .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
    .where(eq(authSession.id, id))
    .returning();

  return refreshed ?? session;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(authSession).where(eq(authSession.id, hashSessionToken(token)));
}

/** Used on a password change, so a session someone else still holds stops working. */
export async function deleteOtherSessions(
  db: Database,
  userId: number,
  keepToken: string,
): Promise<void> {
  await db
    .delete(authSession)
    .where(and(eq(authSession.userId, userId), ne(authSession.id, hashSessionToken(keepToken))));
}
