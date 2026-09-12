import type { Job, PgBoss, Queue, ScheduleOptions, WorkOptions } from 'pg-boss';
import type { Logger } from '../logger.js';

/**
 * Job payloads arrive as JSON from another process, so a handler is handed `unknown` and validates
 * what it needs. A batch is delivered as an array even when `batchSize` is 1.
 */
export type JobHandler = (jobs: readonly Job<unknown>[]) => Promise<void>;

/** One queue this process consumes: what to create, what to run, and any recurring schedule. */
export interface QueueRegistration {
  readonly name: string;
  readonly handler: JobHandler;
  readonly queueOptions?: Omit<Queue, 'name'>;
  readonly workOptions?: WorkOptions;
  readonly schedule?: { readonly cron: string; readonly options?: ScheduleOptions };
}

export class DuplicateQueueError extends Error {
  override readonly name = 'DuplicateQueueError';
}

/**
 * pg-boss keeps both workers when a queue is registered twice, which would run every job in that
 * queue as often as it was registered. Registration is derived from config, so a mistake there is
 * a programming error worth failing on rather than a condition to recover from.
 */
export function assertUniqueQueues(registrations: readonly QueueRegistration[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { name } of registrations) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    throw new DuplicateQueueError(
      `queue registered more than once: ${[...duplicates].sort().join(', ')}`,
    );
  }
}

/** Create each queue, subscribe its handler, and install its schedule if it has one. */
export async function registerQueues(
  boss: PgBoss,
  registrations: readonly QueueRegistration[],
  logger: Logger,
): Promise<void> {
  assertUniqueQueues(registrations);

  for (const { name, handler, queueOptions, workOptions, schedule } of registrations) {
    await boss.createQueue(name, queueOptions);
    await boss.work(name, workOptions ?? {}, (jobs) => handler(jobs));
    if (schedule) await boss.schedule(name, schedule.cron, null, schedule.options);
  }

  logger.info('subscribed to queues', { queues: registrations.map(({ name }) => name) });
}
