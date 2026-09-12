import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { processHeartbeat } from '../db/schema.js';
import type { Logger } from '../logger.js';
import { type HeartbeatRole, heartbeatQueueName } from './names.js';
import type { QueueRegistration } from './registry.js';

export const HEARTBEAT_CRON = '*/5 * * * *';

/** Twice the interval, so one missed tick is not read as a dead process. */
export const HEARTBEAT_STALE_AFTER_MS = 10 * 60 * 1000;

export async function recordHeartbeat(db: Database, role: HeartbeatRole): Promise<void> {
  await db
    .insert(processHeartbeat)
    .values({ role })
    .onConflictDoUpdate({ target: processHeartbeat.role, set: { lastSeenAt: sql`now()` } });
}

/**
 * The heartbeat for one role. A process subscribes only to its own roles' queues, so a stale
 * `last_seen` means that role has no process answering rather than that the job failed.
 */
export function heartbeatRegistration(
  db: Database,
  role: HeartbeatRole,
  logger: Logger,
): QueueRegistration {
  return {
    name: heartbeatQueueName(role),
    queueOptions: {
      // Liveness has no history worth keeping, and a role that is down should not accrue a backlog.
      policy: 'short',
      retryLimit: 0,
      expireInSeconds: 60,
      retentionSeconds: 600,
      deleteAfterSeconds: 600,
    },
    schedule: { cron: HEARTBEAT_CRON },
    handler: async () => {
      await recordHeartbeat(db, role);
      logger.debug('heartbeat recorded', { role });
    },
  };
}
