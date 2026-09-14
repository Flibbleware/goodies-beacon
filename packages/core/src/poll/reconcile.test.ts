import type { PgBoss, Schedule } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import type { Database } from '../db/client.js';
import { createSilentLogger } from '../logger.js';
import type { MarketplaceSourceId } from '../sources.js';
import type { ActivePlan } from './plans.js';
import { desiredSchedules, reconcileSchedules } from './reconcile.js';

const logger = createSilentLogger();

function activePlan(overrides: Partial<ActivePlan> & { id: string }): ActivePlan {
  const { id, ...rest } = overrides;
  return {
    wantedItemId: '11111111-1111-1111-1111-111111111111',
    itemTitle: 'Carmageddon big box',
    specVersionId: '22222222-2222-2222-2222-222222222222',
    source: 'ebay',
    pollEvery: null,
    plan: {
      id,
      source: 'ebay',
      query: 'carmageddon',
      region: 'EBAY_GB',
      options: {},
      enabled: true,
      watermark: null,
    },
    ...rest,
  };
}

const deps = {
  logger,
  defaultInterval: 'PT8H',
  minimumInterval: (source: MarketplaceSourceId) => (source === 'ebay' ? 'PT1H' : undefined),
};

describe('desiredSchedules', () => {
  it('puts a plan on its source’s queue, keyed by the plan id', () => {
    const [schedule] = desiredSchedules([activePlan({ id: 'plan-a' })], deps);

    expect(schedule?.queue).toBe('poll.ebay');
    expect(schedule?.key).toBe('plan-a');
    expect(schedule?.data).toEqual({
      wantedItemId: '11111111-1111-1111-1111-111111111111',
      planId: 'plan-a',
      source: 'ebay',
    });
  });

  it('uses the item’s own interval when it has one, and the instance default otherwise', () => {
    const [item, fallback] = desiredSchedules(
      [activePlan({ id: 'plan-a', pollEvery: 'PT2H' }), activePlan({ id: 'plan-b' })],
      deps,
    );

    expect(item?.cron).toMatch(/\/2 \* \* \*$/);
    expect(fallback?.cron).toMatch(/\/8 \* \* \*$/);
  });

  /** §5: the adapter's `recommendedMinInterval` is a floor the scheduler will not go under. */
  it('clamps an interval faster than the source allows', () => {
    const [schedule] = desiredSchedules([activePlan({ id: 'plan-a', pollEvery: 'PT5M' })], deps);
    expect(schedule?.cron).toMatch(/^\d{1,2} \* \* \* \*$/);
  });

  /**
   * A typo in the interval must not take the plan off the schedule: it falls back to the default,
   * which is what the item would have used had the field been left alone.
   */
  it('falls back to the default rather than dropping a plan with an unreadable interval', () => {
    const schedules = desiredSchedules([activePlan({ id: 'plan-a', pollEvery: 'every 8h' })], deps);

    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.cron).toMatch(/\/8 \* \* \*$/);
  });

  it('staggers two plans of the same item so they do not fire together', () => {
    const [first, second] = desiredSchedules(
      [activePlan({ id: 'plan-a' }), activePlan({ id: 'plan-b' })],
      deps,
    );
    expect(first?.cron).not.toBe(second?.cron);
  });
});

/** A pg-boss stand-in: enough of the schedule API to prove the diff, and a record of every call. */
function fakeBoss(rows: Partial<Schedule>[] = []) {
  const schedules = rows.map((row) => ({ name: 'poll.ebay', key: '', cron: '', ...row }));
  const calls: string[] = [];

  return {
    calls,
    schedules,
    boss: {
      async getSchedules() {
        return schedules as Schedule[];
      },
      async schedule(name: string, cron: string, _data: unknown, options?: { key?: string }) {
        calls.push(`schedule ${name} ${options?.key} ${cron}`);
      },
      async unschedule(name: string, key?: string) {
        calls.push(`unschedule ${name} ${key}`);
      },
    } as unknown as PgBoss,
  };
}

/** `activePlans` reads two tables; the join is exercised by the integration test in apps/worker. */
function fakeDb(rows: unknown[]): Database {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => rows,
  };
  return { select: () => chain } as unknown as Database;
}

const row = (planId: string, enabled = true) => ({
  wantedItemId: '11111111-1111-1111-1111-111111111111',
  itemTitle: 'Carmageddon big box',
  pollEvery: 'PT8H',
  specVersionId: '22222222-2222-2222-2222-222222222222',
  settings: { sources: ['ebay'], listingTypes: ['auction', 'fixed'] },
  searchPlans: [{ id: planId, source: 'ebay', query: 'carmageddon', region: 'EBAY_GB', enabled }],
});

describe('reconcileSchedules', () => {
  it('installs a schedule for a plan that has none', async () => {
    const { boss, calls } = fakeBoss();

    const result = await reconcileSchedules({ ...deps, db: fakeDb([row('plan-a')]), boss });

    expect(result.added).toEqual(['plan-a']);
    expect(calls[0]).toMatch(/^schedule poll\.ebay plan-a /);
  });

  /** "Pausing an item updates the schedule without a restart" is this line. */
  it('removes the schedule of a plan that is no longer active', async () => {
    const { boss, calls } = fakeBoss([{ key: 'plan-a', cron: '7 3/8 * * *' }]);

    const result = await reconcileSchedules({ ...deps, db: fakeDb([row('plan-a', false)]), boss });

    expect(result.removed).toEqual(['plan-a']);
    expect(calls).toEqual(['unschedule poll.ebay plan-a']);
  });

  it('rewrites a schedule whose interval has changed', async () => {
    const { boss, calls } = fakeBoss([{ key: 'plan-a', cron: '0 0 * * *' }]);

    const result = await reconcileSchedules({ ...deps, db: fakeDb([row('plan-a')]), boss });

    expect(result.updated).toEqual(['plan-a']);
    expect(calls[0]).toMatch(/\/8 \* \* \*$/);
  });

  /** Runs every minute, so an unchanged instance must not rewrite its schedules each time. */
  it('leaves a matching schedule alone', async () => {
    const [wanted] = desiredSchedules([activePlan({ id: 'plan-a', pollEvery: 'PT8H' })], deps);
    const settled = fakeBoss([{ key: 'plan-a', cron: wanted?.cron ?? '' }]);

    const result = await reconcileSchedules({
      ...deps,
      db: fakeDb([row('plan-a')]),
      boss: settled.boss,
    });

    expect(result).toMatchObject({ added: [], updated: [], removed: [], unchanged: 1 });
    expect(settled.calls).toEqual([]);
  });

  /**
   * The heartbeat, the rates refresh and the reconciler's own schedule are installed at startup
   * and are not derived from any plan; touching them here would delete them on the first run.
   */
  it('never touches a schedule that is not a poll', async () => {
    const { boss, calls } = fakeBoss([
      { name: 'heartbeat.worker', key: '', cron: '*/5 * * * *' },
      { name: 'rates.refresh', key: '', cron: '20 16,21 * * *' },
    ]);

    await reconcileSchedules({ ...deps, db: fakeDb([]), boss });

    expect(calls).toEqual([]);
  });
});
