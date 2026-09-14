import {
  type AdapterContext,
  type Converter,
  candidates,
  createDb,
  createMemoryCookieJar,
  createPool,
  createSilentLogger,
  type Database,
  listings,
  type PollTarget,
  reconcileSchedules,
  runMigrations,
  runPoll,
  searchPlanState,
  seen,
  specVersions,
  wantedItems,
} from '@goodies-beacon/core';
import { templateAdapter } from '@goodies-beacon/source-template';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { PgBoss, Schedule } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * P1-07's acceptance test: the poll job against a real database and the template adapter.
 *
 * It lives in apps/worker rather than in core because core cannot depend on a source package
 * without a cycle, and the template adapter is the one marketplace that can be made to return
 * exactly the listings a case needs.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const logger = createSilentLogger();

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

/** The fixture marketplace: listings numbered oldest to newest, one minute apart. */
interface FakeListing {
  id: string;
  listedAt: Date;
}

const EPOCH = new Date('2026-09-01T00:00:00.000Z');

function stock(count: number, from = 1): FakeListing[] {
  return Array.from({ length: count }, (_, n) => ({
    id: `item-${from + n}`,
    listedAt: new Date(EPOCH.getTime() + (from + n) * 60_000),
  }));
}

/**
 * A context whose HTTP client is the fixture marketplace, honouring the three things the poll
 * relies on: newest-first ordering, the `since` watermark and the `before` ceiling a capped run
 * leaves behind.
 */
function fixtureContext(catalogue: FakeListing[], options: { pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 20;
  const requests: string[] = [];
  let failWith: string | null = null;

  const ctx: AdapterContext = {
    source: '_template',
    cookies: createMemoryCookieJar(),
    browser: null,
    logger,
    credentials: { apiKey: 'fixture', sellerSalt: 'poll-integration-salt' },
    http: {
      async fetch(url: string) {
        requests.push(url);
        if (failWith) return new Response(failWith, { status: 503 });

        const parsed = new URL(url);
        const since = parsed.searchParams.get('since');
        const before = parsed.searchParams.get('before');
        const offset = Number(parsed.searchParams.get('offset') ?? 0);

        const matching = catalogue
          .filter((entry) => (since ? entry.listedAt > new Date(since) : true))
          .filter((entry) => (before ? entry.listedAt < new Date(before) : true))
          .sort((a, b) => b.listedAt.getTime() - a.listedAt.getTime());

        const page = matching.slice(offset, offset + pageSize);
        const nextOffset = offset + pageSize < matching.length ? offset + pageSize : null;

        return Response.json({
          results: page.map((entry) => ({
            id: entry.id,
            name: `Carmageddon ${entry.id}`,
            price: { amount: '25.00', currency: 'GBP' },
            kind: 'fixed',
            seller: { handle: `seller-${entry.id}` },
            country: 'GB',
            thumbnail: `https://fixtures.example.invalid/${entry.id}.jpg`,
            listedAt: entry.listedAt.toISOString(),
            link: `https://fixtures.example.invalid/listing/${entry.id}`,
          })),
          nextOffset,
        });
      },
      async exitAddress() {
        return { ip: '203.0.113.1', country: 'GB' };
      },
    },
  };

  return { ctx, requests, fail: (body: string) => (failWith = body) };
}

/** GBP in, GBP out: currency conversion is P1-06's and has its own tests. */
const converter: Converter = {
  async toGbp(amount) {
    return { amountGbp: amount, rateDate: null };
  },
  invalidate() {},
};

async function seedItem(options: {
  title: string;
  planId: string;
  status?: 'active' | 'paused';
  pollEvery?: string | null;
  source?: string;
  enabled?: boolean;
}): Promise<PollTarget> {
  const [item] = await db
    .insert(wantedItems)
    .values({
      title: options.title,
      status: options.status ?? 'active',
      pollEvery: options.pollEvery ?? null,
    })
    .returning({ id: wantedItems.id });
  if (!item) throw new Error('could not seed the wanted item');

  const source = options.source ?? '_template';
  const [version] = await db
    .insert(specVersions)
    .values({
      wantedItemId: item.id,
      version: 1,
      createdBy: 'manual_edit',
      summary: options.title,
      settings: { sources: [source], listingTypes: ['auction', 'fixed'] },
      searchPlans: [
        {
          id: options.planId,
          source,
          query: 'carmageddon',
          region: 'example',
          enabled: options.enabled ?? true,
        },
      ],
    })
    .returning({ id: specVersions.id });
  if (!version) throw new Error('could not seed the spec version');

  await db
    .update(wantedItems)
    .set({ currentSpecVersionId: version.id })
    .where(eq(wantedItems.id, item.id));

  return {
    wantedItemId: item.id,
    specVersionId: version.id,
    source: source as PollTarget['source'],
    plan: {
      id: options.planId,
      source: source as PollTarget['source'],
      query: 'carmageddon',
      region: 'example',
      options: {},
      enabled: options.enabled ?? true,
      watermark: null,
    },
  };
}

function poll(
  target: PollTarget,
  ctx: AdapterContext,
  overrides: { cap?: number; reviewed?: string[] } = {},
) {
  return runPoll({
    db,
    converter,
    logger,
    enqueueReview: async (candidateId) => {
      overrides.reviewed?.push(candidateId);
    },
    adapter: templateAdapter,
    ctx,
    plan: target,
    mode: 'poll',
    cap: overrides.cap ?? 50,
  });
}

/** Warms a plan up, so a case can be about the cap rather than about a plan's first ever run. */
async function setWatermark(target: PollTarget, watermark: Date): Promise<void> {
  await db
    .insert(searchPlanState)
    .values({
      planId: target.plan.id,
      wantedItemId: target.wantedItemId,
      source: target.source,
      watermark,
    })
    .onConflictDoUpdate({ target: searchPlanState.planId, set: { watermark } });
}

const planState = async (planId: string) => {
  const [row] = await db.select().from(searchPlanState).where(eq(searchPlanState.planId, planId));
  return row;
};

describe.skipIf(!databaseUrl)('the poll job against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(candidates);
    await db.delete(searchPlanState);
    await db.delete(specVersions);
    await db.delete(wantedItems);
    await db.delete(listings);
    await db.delete(seen);
  });

  it('creates each candidate once across two overlapping polls and advances the watermark', async () => {
    const target = await seedItem({ title: 'Carmageddon', planId: 'plan-overlap' });
    const catalogue = stock(5);
    const marketplace = fixtureContext(catalogue);
    const reviewed: string[] = [];

    const first = await poll(target, marketplace.ctx, { reviewed });
    expect(first.newCandidates).toBe(5);
    expect(first.watermark?.toISOString()).toBe(catalogue.at(-1)?.listedAt.toISOString());

    // Two more listings arrive; the marketplace still returns the five from before.
    catalogue.push(...stock(2, 6));
    const second = await poll(target, marketplace.ctx, { reviewed });

    expect(second.processed).toBe(2);
    expect(second.newCandidates).toBe(2);
    expect(second.watermark?.toISOString()).toBe(catalogue.at(-1)?.listedAt.toISOString());

    const rows = await db.select().from(candidates);
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((row) => row.listingId)).size).toBe(7);
    expect(reviewed).toHaveLength(7);
    expect(new Set(reviewed).size).toBe(7);
  });

  /**
   * The watermark alone cannot express "I did the newest fifty, the older ones are still owed":
   * results come newest-first, so without a ceiling the next run fetches the same fifty again.
   */
  it('resumes exactly where it stopped when a poll hits the cap', async () => {
    const target = await seedItem({ title: 'Carmageddon', planId: 'plan-cap' });
    const catalogue = stock(25);
    const marketplace = fixtureContext(catalogue, { pageSize: 5 });
    // A warm plan: twenty-five listings have appeared since it last ran, and the cap is ten.
    await setWatermark(target, EPOCH);

    const first = await poll(target, marketplace.ctx, { cap: 10 });
    expect(first.stoppedAtCap).toBe(true);
    expect(first.processed).toBe(10);

    // The newest ten, and a backlog covering everything below them.
    const afterFirst = await planState('plan-cap');
    expect(afterFirst?.watermark?.toISOString()).toBe(catalogue.at(-1)?.listedAt.toISOString());
    expect(afterFirst?.backlogUntil?.toISOString()).toBe(catalogue.at(-10)?.listedAt.toISOString());

    const second = await poll(target, marketplace.ctx, { cap: 10 });
    expect(second.drainingBacklog).toBe(true);
    expect(second.processed).toBe(10);

    const third = await poll(target, marketplace.ctx, { cap: 10 });
    expect(third.drainingBacklog).toBe(true);
    expect(third.processed).toBe(5);
    expect(third.stoppedAtCap).toBe(false);

    // Every listing reached, once each, and the backlog is closed.
    const rows = await db.select().from(candidates);
    expect(rows).toHaveLength(25);

    const afterThird = await planState('plan-cap');
    expect(afterThird?.backlogFrom).toBeNull();
    expect(afterThird?.backlogUntil).toBeNull();
    expect(afterThird?.watermark?.toISOString()).toBe(catalogue.at(-1)?.listedAt.toISOString());
  });

  /**
   * A plan's first run has no watermark, so its window is the whole history of the query. Walking
   * backwards through that fifty at a time until eBay runs out is what `settings.backfill` is for,
   * and it is off by default — so a cold run takes the newest page and stops there.
   */
  it('does not walk backwards through a marketplace\u2019s history on a plan\u2019s first run', async () => {
    const target = await seedItem({ title: 'Carmageddon', planId: 'plan-cold' });
    const catalogue = stock(25);

    const first = await poll(target, fixtureContext(catalogue, { pageSize: 5 }).ctx, { cap: 10 });
    expect(first.stoppedAtCap).toBe(true);

    const state = await planState('plan-cold');
    expect(state?.backlogFrom).toBeNull();
    expect(state?.watermark?.toISOString()).toBe(catalogue.at(-1)?.listedAt.toISOString());

    const second = await poll(target, fixtureContext(catalogue, { pageSize: 5 }).ctx, { cap: 10 });
    expect(second.processed).toBe(0);
  });

  it('records an adapter failure as a health event and lets the job fail so pg-boss retries', async () => {
    const target = await seedItem({ title: 'Carmageddon', planId: 'plan-fails' });
    const marketplace = fixtureContext(stock(3));
    marketplace.fail('the marketplace is having a bad minute');

    await expect(poll(target, marketplace.ctx)).rejects.toThrow('HTTP 503');

    const state = await planState('plan-fails');
    expect(state?.lastError).toContain('503');
    expect(state?.lastRunAt).not.toBeNull();
    // Untouched, so the dashboard can say "failing since" rather than only "failed".
    expect(state?.lastSuccessAt).toBeNull();
  });

  it('clears the error once a later poll succeeds', async () => {
    const target = await seedItem({ title: 'Carmageddon', planId: 'plan-recovers' });
    const marketplace = fixtureContext(stock(2));
    marketplace.fail('down');
    await expect(poll(target, marketplace.ctx)).rejects.toThrow();

    const recovered = fixtureContext(stock(2));
    await poll(target, recovered.ctx);

    const state = await planState('plan-recovers');
    expect(state?.lastError).toBeNull();
    expect(state?.lastSuccessAt).not.toBeNull();
  });

  /**
   * §6 says a listing already in `seen` is ignored. `seen` is keyed on (source, externalId) and so
   * is global, which would starve the second of two items that want the same listing; the per-item
   * answer is the `candidates` unique index (see the P1-07 note in ARCHITECTURE.md §6).
   */
  it('gives two wanted items their own candidate for the same listing', async () => {
    const first = await seedItem({ title: 'Carmageddon', planId: 'plan-one' });
    const second = await seedItem({ title: 'Carmageddon 2', planId: 'plan-two' });
    const catalogue = stock(3);

    const one = await poll(first, fixtureContext(catalogue).ctx);
    const two = await poll(second, fixtureContext(catalogue).ctx);

    expect(one.newCandidates).toBe(3);
    expect(one.newListings).toBe(3);
    expect(two.newCandidates).toBe(3);
    // Same three listings, so nothing was new to the instance the second time around.
    expect(two.newListings).toBe(0);

    expect(await db.select().from(listings)).toHaveLength(3);
    expect(await db.select().from(candidates)).toHaveLength(6);
  });

  it('updates lastSeenAt on a listing it already holds rather than storing it twice', async () => {
    const target = await seedItem({ title: 'Carmageddon', planId: 'plan-reseen' });
    const catalogue = stock(1);

    await poll(target, fixtureContext(catalogue).ctx);
    const [before] = await db.select().from(listings);

    // A second plan meeting the same listing, so the watermark does not filter it out.
    const other = await seedItem({ title: 'Carmageddon 2', planId: 'plan-reseen-2' });
    await poll(other, fixtureContext(catalogue).ctx);
    const [after] = await db.select().from(listings);

    expect(after?.id).toBe(before?.id);
    expect(after?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before?.lastSeenAt.getTime() ?? 0);
    expect(after?.firstSeenAt.toISOString()).toBe(before?.firstSeenAt.toISOString());
  });

  it('counts the candidates it found against the plan', async () => {
    const target = await seedItem({ title: 'Carmageddon', planId: 'plan-counts' });
    const catalogue = stock(4);
    const marketplace = fixtureContext(catalogue);

    await poll(target, marketplace.ctx);
    catalogue.push(...stock(2, 5));
    await poll(target, marketplace.ctx);

    expect((await planState('plan-counts'))?.candidatesFound).toBe(6);
  });
});

/** A pg-boss stand-in: the reconciler's diff is what is under test, not pg-boss itself. */
function fakeBoss(rows: { name: string; key: string; cron: string }[] = []) {
  const calls: string[] = [];
  return {
    calls,
    boss: {
      async getSchedules() {
        return rows as Schedule[];
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

const reconcileDeps = {
  logger,
  defaultInterval: 'PT8H',
  minimumInterval: () => 'PT1H',
};

describe.skipIf(!databaseUrl)('the schedule reconciler against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool ??= createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(candidates);
    await db.delete(searchPlanState);
    await db.delete(specVersions);
    await db.delete(wantedItems);
  });

  it('schedules an active item’s plan on its source queue', async () => {
    await seedItem({ title: 'Carmageddon', planId: 'plan-sched', source: 'ebay' });
    const { boss, calls } = fakeBoss();

    const result = await reconcileSchedules({ ...reconcileDeps, db, boss });

    expect(result.added).toEqual(['plan-sched']);
    expect(calls[0]).toMatch(/^schedule poll\.ebay plan-sched /);
  });

  /** "Changing an item's interval updates the schedule without a restart." */
  it('rewrites the schedule when the interval changes', async () => {
    const target = await seedItem({
      title: 'Carmageddon',
      planId: 'plan-interval',
      source: 'ebay',
    });
    const first = fakeBoss();
    await reconcileSchedules({ ...reconcileDeps, db, boss: first.boss });
    const installed = first.calls[0]?.split(' ').slice(3).join(' ') ?? '';

    await db
      .update(wantedItems)
      .set({ pollEvery: 'PT2H' })
      .where(eq(wantedItems.id, target.wantedItemId));

    const second = fakeBoss([{ name: 'poll.ebay', key: 'plan-interval', cron: installed }]);
    const result = await reconcileSchedules({ ...reconcileDeps, db, boss: second.boss });

    expect(result.updated).toEqual(['plan-interval']);
    expect(second.calls[0]).toMatch(/\/2 \* \* \*$/);
  });

  /** "…or pausing it." */
  it('removes the schedule when the item is paused', async () => {
    const target = await seedItem({ title: 'Carmageddon', planId: 'plan-paused', source: 'ebay' });
    const first = fakeBoss();
    await reconcileSchedules({ ...reconcileDeps, db, boss: first.boss });
    const installed = first.calls[0]?.split(' ').slice(3).join(' ') ?? '';

    await db
      .update(wantedItems)
      .set({ status: 'paused' })
      .where(eq(wantedItems.id, target.wantedItemId));

    const second = fakeBoss([{ name: 'poll.ebay', key: 'plan-paused', cron: installed }]);
    const result = await reconcileSchedules({ ...reconcileDeps, db, boss: second.boss });

    expect(result.removed).toEqual(['plan-paused']);
  });

  /** The template is storable but not pollable, so it must never reach a schedule. */
  it('never schedules a source that has no queue', async () => {
    await seedItem({ title: 'Carmageddon', planId: 'plan-template' });
    const { boss, calls } = fakeBoss();

    const result = await reconcileSchedules({ ...reconcileDeps, db, boss });

    expect(result.added).toEqual([]);
    expect(calls).toEqual([]);
  });
});
