import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Arbitrary but fixed, so every process contends for the same lock. Postgres advisory locks
 * are per-session, so the lock must be taken and released on one dedicated connection.
 */
const MIGRATION_LOCK_ID = 4_143_072_101;

/** Resolves to packages/core/drizzle from both src (tsx) and dist (node), which are equally deep. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Apply any outstanding migrations. Safe to call from every container at once: the advisory
 * lock serialises them, and Drizzle skips migrations already recorded, so the losers no-op.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
      try {
        await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
