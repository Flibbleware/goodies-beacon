import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { type AuthUser, authUser } from '../db/schema.js';
import { hashPassword } from './password.js';

/** There is one user, in one row (§12). Its id is fixed by the singleton check constraint. */
export const USER_ID = 1;

export class AuthUserExistsError extends Error {
  override readonly name = 'AuthUserExistsError';
}

export async function findAuthUser(db: Database): Promise<AuthUser | undefined> {
  const [user] = await db.select().from(authUser).where(eq(authUser.id, USER_ID));
  return user;
}

/**
 * First run only. Two requests arriving together cannot both win: the insert conflicts on the
 * primary key, so the loser is told the password is already set rather than overwriting it.
 */
export async function createAuthUser(db: Database, password: string): Promise<AuthUser> {
  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(authUser)
    .values({ id: USER_ID, passwordHash })
    .onConflictDoNothing()
    .returning();

  if (!created) throw new AuthUserExistsError('a password has already been set');
  return created;
}

export async function updatePassword(db: Database, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db
    .update(authUser)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(authUser.id, USER_ID));
}
