import { randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
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

export function createSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url');
}

export async function createSession(
  db: Database,
  userId: number,
  now = new Date(),
): Promise<AuthSession> {
  const [created] = await db
    .insert(authSession)
    .values({
      id: createSessionId(),
      userId,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .returning();

  // The insert either returns its row or throws; this keeps the type honest.
  if (!created) throw new Error('session insert returned no row');
  return created;
}

/**
 * The session for this id, or undefined if there is none or it has expired. An expired row is
 * deleted on the way past, so a cookie left behind by a closed laptop cleans itself up.
 */
export async function loadSession(
  db: Database,
  id: string,
  now = new Date(),
): Promise<AuthSession | undefined> {
  const [session] = await db.select().from(authSession).where(eq(authSession.id, id));
  if (!session) return undefined;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await deleteSession(db, id);
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

export async function deleteSession(db: Database, id: string): Promise<void> {
  await db.delete(authSession).where(eq(authSession.id, id));
}

/** Used on a password change, so a session someone else still holds stops working. */
export async function deleteOtherSessions(
  db: Database,
  userId: number,
  keepId: string,
): Promise<void> {
  await db
    .delete(authSession)
    .where(and(eq(authSession.userId, userId), ne(authSession.id, keepId)));
}
