import { heartbeatRegistration, type QueueRegistration, type Role } from '@goodies-beacon/core';
import type { WorkerDeps } from '@goodies-beacon/worker';

export function servesApi(role: Role): boolean {
  return role === 'api' || role === 'all';
}

export function runsWorker(role: Role): boolean {
  return role === 'worker' || role === 'all';
}

/**
 * The queues this process consumes, from `ROLE`. The worker package is imported only when a
 * worker role needs it, so an API-only process never loads adapter dependencies.
 */
export async function processRegistrations(deps: WorkerDeps): Promise<QueueRegistration[]> {
  const { config, db, logger } = deps;
  const registrations: QueueRegistration[] = [];

  if (servesApi(config.role)) registrations.push(heartbeatRegistration(db, 'api', logger));
  if (runsWorker(config.role)) {
    const { workerRegistrations } = await import('@goodies-beacon/worker');
    registrations.push(...workerRegistrations(deps));
  }

  return registrations;
}
