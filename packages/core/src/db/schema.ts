import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * One row holding the whole instance configuration as JSONB. Secrets inside `data` are
 * stored as `enc:v1:<ciphertext>` (see crypto.ts); the check constraint is what makes the
 * singleton real rather than a convention.
 */
export const settings = pgTable(
  'settings',
  {
    id: smallint('id').primaryKey().default(1),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [check('settings_is_singleton', sql`${table.id} = 1`)],
);

/** The single user (§12). Absent until the first-run password is set in P0-07. */
export const authUser = pgTable(
  'auth_user',
  {
    id: smallint('id').primaryKey().default(1),
    passwordHash: text('password_hash').notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [check('auth_user_is_singleton', sql`${table.id} = 1`)],
);

export const authSession = pgTable(
  'auth_session',
  {
    /** 256 bits of randomness, base64url; never a sequential id. */
    id: text('id').primaryKey(),
    userId: smallint('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    createdAt,
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('auth_session_expires_at_idx').on(table.expiresAt)],
);

/**
 * Liveness per process role, written by the `heartbeat.<role>` job every five minutes (§P0-06).
 * One row per role rather than per process: what the dashboard asks is whether an API and a worker
 * are answering, not how many of each there are.
 */
export const processHeartbeat = pgTable('process_heartbeat', {
  role: text('role').primaryKey(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SettingsRow = typeof settings.$inferSelect;
export type AuthUser = typeof authUser.$inferSelect;
export type AuthSession = typeof authSession.$inferSelect;
export type ProcessHeartbeat = typeof processHeartbeat.$inferSelect;
