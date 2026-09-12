import type { Role } from '../config.js';
import { SOURCE_IDS, type SourceId } from '../sources.js';

/**
 * Queue names are stored in Postgres alongside their jobs, so renaming one orphans whatever is
 * already queued. Each name carries its subject (§6) so a remote worker can subscribe to a subset;
 * the separator is a period rather than the colon §6 writes because pg-boss validates names
 * against /^[\w.\-/]+$/ and rejects a colon outright.
 */
export function pollQueueName(source: SourceId): string {
  return `poll.${source}`;
}

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
  return workerSources.length > 0 ? workerSources : SOURCE_IDS;
}
