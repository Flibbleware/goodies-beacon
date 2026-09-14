import type { PgBoss } from 'pg-boss';
import type { Database } from '../db/client.js';
import type { Logger } from '../logger.js';
import { pollQueueName, SCHEDULE_QUEUE } from '../queue/names.js';
import type { QueueRegistration } from '../queue/registry.js';
import type { MarketplaceSourceId } from '../sources.js';
import { durationToMinutes, IntervalError, pollSchedule } from './interval.js';
import { type ActivePlan, activePlans } from './plans.js';

/**
 * Keeping pg-boss's schedules equal to what the database says should be polling (§6).
 *
 * Reconciling rather than scheduling on demand is what makes "pause an item" or "poll this one
 * hourly" take effect without a restart, and it is also what repairs a schedule that was written
 * while a deploy was half way through. It runs on a cron *and* on demand, because the cron alone
 * would leave a user watching a Save button wondering whether it worked.
 */

/** Often enough that an edit in the UI takes effect while the person is still looking at it. */
export const RECONCILE_CRON = '* * * * *';

export interface DesiredSchedule {
  /** pg-boss schedules are keyed by (queue, key); the plan id is the key. */
  queue: string;
  key: string;
  cron: string;
  data: PollJobData;
}

export interface PollJobData {
  wantedItemId: string;
  planId: string;
  source: MarketplaceSourceId;
}

export interface ReconcileResult {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
}

export interface ReconcileDeps {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly logger: Logger;
  /** The instance default, for items whose own interval is null (§4). */
  readonly defaultInterval: string;
  /** A source's `recommendedMinInterval`; the scheduler refuses to poll faster than it (§5). */
  readonly minimumInterval: (source: MarketplaceSourceId) => string | undefined;
}

/** What the database says should be scheduled, as pg-boss rows. */
export function desiredSchedules(
  plans: readonly ActivePlan[],
  deps: Pick<ReconcileDeps, 'defaultInterval' | 'minimumInterval' | 'logger'>,
): DesiredSchedule[] {
  const schedules: DesiredSchedule[] = [];

  for (const entry of plans) {
    const requested = entry.pollEvery ?? deps.defaultInterval;
    const minimum = deps.minimumInterval(entry.source);

    let minutes: number;
    try {
      minutes = durationToMinutes(requested);
    } catch (error) {
      // An unreadable interval must not take the plan off the schedule silently: fall back to the
      // instance default, which is what the item would have used had the field been left alone.
      deps.logger.warn('unreadable poll interval; using the instance default', {
        planId: entry.plan.id,
        interval: requested,
        reason: error instanceof IntervalError ? error.message : String(error),
      });
      minutes = durationToMinutes(deps.defaultInterval);
    }

    const floor = minimum ? durationToMinutes(minimum) : 0;
    const schedule = pollSchedule(entry.plan.id, minutes, floor);

    if (schedule.adjustedFrom !== undefined) {
      deps.logger.debug('poll interval adjusted to something cron can express', {
        planId: entry.plan.id,
        requestedMinutes: schedule.adjustedFrom,
        scheduledMinutes: schedule.periodMinutes,
      });
    }

    schedules.push({
      queue: pollQueueName(entry.source),
      key: entry.plan.id,
      cron: schedule.cron,
      data: { wantedItemId: entry.wantedItemId, planId: entry.plan.id, source: entry.source },
    });
  }

  return schedules;
}

/**
 * Installs, updates and removes poll schedules so pg-boss matches the database.
 *
 * Only `poll.*` schedules are touched. The heartbeat, the rates refresh and this job's own
 * schedule live on other queues and are installed at startup; a reconciler that removed anything
 * it did not recognise would delete them on its first run.
 */
export async function reconcileSchedules(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { boss, logger } = deps;
  const plans = await activePlans(deps.db, logger);
  const wanted = desiredSchedules(plans, deps);
  const wantedByKey = new Map(wanted.map((entry) => [scheduleId(entry.queue, entry.key), entry]));

  const installed = (await boss.getSchedules()).filter((row) => row.name.startsWith('poll.'));
  const result: ReconcileResult = { added: [], updated: [], removed: [], unchanged: 0 };

  for (const row of installed) {
    const id = scheduleId(row.name, row.key);
    const desired = wantedByKey.get(id);

    if (!desired) {
      await boss.unschedule(row.name, row.key);
      result.removed.push(row.key);
      continue;
    }

    wantedByKey.delete(id);
    if (row.cron === desired.cron) {
      result.unchanged += 1;
      continue;
    }

    await boss.schedule(desired.queue, desired.cron, desired.data, { key: desired.key });
    result.updated.push(desired.key);
  }

  for (const desired of wantedByKey.values()) {
    await boss.schedule(desired.queue, desired.cron, desired.data, { key: desired.key });
    result.added.push(desired.key);
  }

  // Logged only when something moved: this runs every minute and a quiet instance should be quiet.
  if (result.added.length + result.updated.length + result.removed.length > 0) {
    logger.info('poll schedules reconciled', {
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      unchanged: result.unchanged,
    });
  }

  return result;
}

/** A plan id is arbitrary text, so the two halves are encoded rather than joined by a separator. */
function scheduleId(queue: string, key: string): string {
  return JSON.stringify([queue, key]);
}

export function reconcileRegistration(
  deps: Omit<ReconcileDeps, 'defaultInterval'> & { defaultInterval: () => Promise<string> },
): QueueRegistration {
  return {
    name: SCHEDULE_QUEUE,
    queueOptions: {
      // One reconcile is as good as another; a backlog of them would each do the same work.
      policy: 'short',
      retryLimit: 2,
      retryDelay: 30,
      expireInSeconds: 120,
      retentionSeconds: 3600,
    },
    schedule: { cron: RECONCILE_CRON },
    handler: async () => {
      await reconcileSchedules({ ...deps, defaultInterval: await deps.defaultInterval() });
    },
  };
}
