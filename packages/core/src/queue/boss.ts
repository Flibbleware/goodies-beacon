import { PgBoss } from 'pg-boss';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

/** pg-boss keeps its tables out of the way of Drizzle's; the backup notes in RUNNING.md rely on it. */
export const QUEUE_SCHEMA = 'pgboss';

/**
 * A pg-boss instance on the application database. Not started: the caller registers queues and
 * error logging first, so nothing is fetched before there is a handler for it.
 */
export function createBoss(config: Config, logger: Logger): PgBoss {
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: QUEUE_SCHEMA,
    application_name: `goodies-beacon-${config.role}`,
  });

  // pg-boss emits rather than throws for background failures; unhandled, they would be silent.
  boss.on('error', (error) => logger.error('pg-boss error', { error: error.message }));

  return boss;
}
