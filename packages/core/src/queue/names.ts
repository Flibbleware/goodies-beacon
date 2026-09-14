import type { Role } from '../config.js';
import { MARKETPLACE_SOURCE_IDS, type SourceId } from '../sources.js';

/**
 * Queue names are stored in Postgres alongside their jobs, so renaming one orphans whatever is
 * already queued. Each name carries its subject (§6) so a remote worker can subscribe to a subset;
 * the separator is a period rather than the colon §6 writes because pg-boss validates names
 * against /^[\w.\-/]+$/ and rejects a colon outright.
 */
export function pollQueueName(source: SourceId): string {
  return `poll.${source}`;
}

/**
 * The queue a poll drops each new candidate on (§3's review worker, built in P1-12).
 *
 * It exists from P1-07 so a poll has somewhere to send, and is deliberately created without a
 * subscriber until the reviewer lands: jobs wait in it rather than being discarded, so the first
 * reviewer to start finds the backlog that has accumulated.
 */
export const REVIEW_QUEUE = 'review.candidate';

/**
 * Where the poll schedules are brought back in line with the database (§6).
 *
 * Keeping schedules in a job rather than only at startup is what makes "pause an item" take
 * effect without a restart; the API sends one of these after a change so the effect is immediate
 * rather than waiting for the next tick. Not named `poll.something`: that prefix is the set a
 * remote worker subscribes to by source, and this is work only the core worker does.
 */
export const SCHEDULE_QUEUE = 'schedules.reconcile';

/** Roles that report liveness. `all` reports as both, so it is not a value here. */
export const HEARTBEAT_ROLES = ['api', 'worker'] as const;
export type HeartbeatRole = (typeof HEARTBEAT_ROLES)[number];

export function heartbeatQueueName(role: HeartbeatRole): string {
  return `heartbeat.${role}`;
}

export function heartbeatRolesFor(role: Role): readonly HeartbeatRole[] {
  return role === 'all' ? HEARTBEAT_ROLES : [role];
}

/** The sources a worker polls: every one, unless WORKER_SOURCES narrows it (§6). */
export function pollSourcesFor(workerSources: readonly SourceId[]): readonly SourceId[] {
  return workerSources.length > 0 ? workerSources : MARKETPLACE_SOURCE_IDS;
}
