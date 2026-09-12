import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

/** A wedged server can leave a connection attempt hanging indefinitely; this gives up instead. */
export const CONNECT_TIMEOUT_MS = 5000;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDb>;

export const PING_TIMEOUT_MS = 2000;

/**
 * The cheapest query that proves a connection can be got and used, for `/healthz`.
 *
 * Bounded by its own timer rather than only by the query: a server that accepts the connection
 * and then never answers — a paused container, a wedged host — would otherwise leave `/healthz`
 * hanging until the socket closed, and a monitor waiting on it learns nothing.
 */
export async function pingDatabase(db: Database, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  const query = db.execute(sql`select 1`);
  // The race abandons the query; without this its later rejection is unhandled.
  query.catch(() => {});

  let timer: NodeJS.Timeout | undefined;
  const gaveUp = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([query.then(() => true).catch(() => false), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}
