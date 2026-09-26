import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  candidates,
  listings,
  processHeartbeat,
  searchPlanState,
  seen,
  verdicts,
  wantedItems,
} from '../db/schema.js';
import type { VerdictDecision } from '../domain/constants.js';
import { itemSaveSchema } from '../items/schema.js';
import { createItem, updateItem } from '../items/store.js';
import { dashboardSummary } from './summary.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;
let itemId: string;
let specVersionId: string;
let sequence = 0;

afterAll(async () => {
  await pool?.end();
});

const carmageddon = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL('../domain/fixtures/carmageddon.json', import.meta.url), 'utf8'));

/** Mid-afternoon in London on a day when the clocks say UTC+1, so "today" is not "today in UTC". */
const NOW = new Date('2026-06-16T14:00:00Z');
const summary = () => dashboardSummary(db, { timezone: 'Europe/London', now: NOW });

async function seedCandidate(decision?: VerdictDecision, verdictAt?: Date): Promise<string> {
  sequence += 1;

  const [listing] = await db
    .insert(listings)
    .values({
      source: 'ebay',
      externalId: `listing-${sequence}`,
      url: `https://example.com/${sequence}`,
      title: 'Carmageddon big box',
    })
    .returning({ id: listings.id });
  if (!listing) throw new Error('could not seed the listing');

  const [candidate] = await db
    .insert(candidates)
    .values({
      wantedItemId: itemId,
      listingId: listing.id,
      specVersionId,
      createdAt: verdictAt ?? NOW,
    })
    .returning({ id: candidates.id });
  if (!candidate) throw new Error('could not seed the candidate');

  if (decision) {
    await db.insert(verdicts).values({
      candidateId: candidate.id,
      specVersionId,
      decision,
      criteriaResults: [],
      createdAt: verdictAt ?? NOW,
    });
  }

  return candidate.id;
}

async function seedPlanState(
  planId: string,
  values: Partial<typeof searchPlanState.$inferInsert> = {},
): Promise<void> {
  await db
    .insert(searchPlanState)
    .values({ planId, wantedItemId: itemId, source: 'ebay', ...values })
    .onConflictDoNothing();
}

describe.skipIf(!databaseUrl)('the dashboard summary against a real Postgres', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(candidates);
    await db.delete(listings);
    await db.delete(seen);
    await db.delete(wantedItems);
    await db.delete(processHeartbeat);
    sequence = 0;

    const created = await createItem(
      db,
      itemSaveSchema.parse({
        title: 'Carmageddon big box',
        status: 'active',
        spec: carmageddon(),
      }),
    );
    itemId = created.itemId;
    specVersionId = created.versionId;
  });

  describe("today's verdicts", () => {
    it('counts what has been judged since local midnight, by verdict', async () => {
      await seedCandidate('match');
      await seedCandidate('uncertain');
      await seedCandidate('reject');
      await seedCandidate();

      expect((await summary()).today).toEqual({
        matched: 1,
        uncertain: 1,
        rejected: 1,
        waiting: 1,
      });
    });

    /**
     * The reason `startOfDayIn` exists. In June, London is UTC+1, so a verdict at 00:30 local is
     * 23:30 the previous day in UTC — today's news, and anything truncating the UTC timestamp
     * would file it under yesterday.
     */
    it('counts a verdict from after local midnight but before UTC midnight', async () => {
      await seedCandidate('match', new Date('2026-06-15T23:30:00Z'));

      expect((await summary()).today.matched).toBe(1);
    });

    it('leaves out a verdict from before local midnight', async () => {
      await seedCandidate('match', new Date('2026-06-15T22:30:00Z'));

      expect((await summary()).today.matched).toBe(0);
    });

    /** A candidate re-reviewed today is today's news; its older verdict is not counted again. */
    it('reads each candidate’s newest verdict and no other', async () => {
      const candidateId = await seedCandidate('reject', new Date('2026-06-10T09:00:00Z'));
      await db.insert(verdicts).values({
        candidateId,
        specVersionId,
        decision: 'match',
        criteriaResults: [],
        createdAt: NOW,
      });

      expect((await summary()).today).toMatchObject({ matched: 1, rejected: 0 });
    });
  });

  it('counts items by status', async () => {
    await createItem(db, itemSaveSchema.parse({ title: 'A draft', spec: carmageddon() }));
    const paused = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Paused', status: 'active', spec: carmageddon() }),
    );
    await updateItem(db, paused.itemId, { status: 'paused' });

    expect((await summary()).items).toEqual({ active: 1, paused: 1, draft: 1, total: 3 });
  });

  describe('source health', () => {
    /** A fresh instance must see "eBay, three plans, never polled" rather than an empty panel. */
    it('names a source whose plans exist but have never run', async () => {
      const [source] = (await summary()).sources;

      expect(source).toMatchObject({
        source: 'ebay',
        activePlans: 3,
        lastRunAt: null,
        lastError: null,
        failingPlans: 0,
      });
    });

    it('reports the last run, the last success and the error between them', async () => {
      const succeeded = new Date('2026-06-15T08:00:00Z');
      const failed = new Date('2026-06-16T08:00:00Z');

      await seedPlanState('ebay-gb-carmageddon', {
        lastRunAt: succeeded,
        lastSuccessAt: succeeded,
      });
      await seedPlanState('ebay-us-carmageddon', {
        lastRunAt: failed,
        lastError: 'eBay said 503',
      });

      const [source] = (await summary()).sources;

      expect(source).toMatchObject({
        lastRunAt: failed,
        lastSuccessAt: succeeded,
        lastError: 'eBay said 503',
        failingPlans: 1,
        failingItemId: itemId,
        failingItemTitle: 'Carmageddon big box',
      });
    });

    /**
     * The last error is still the last thing that happened, whatever the item's status is now, so
     * a source drops off the panel only when it has neither plans nor history.
     */
    it('keeps a source that has polled even once its item is paused', async () => {
      await seedPlanState('ebay-gb-carmageddon', { lastRunAt: NOW, lastError: 'eBay said 503' });
      await updateItem(db, itemId, { status: 'paused' });

      const [source] = (await summary()).sources;

      expect(source).toMatchObject({ source: 'ebay', activePlans: 0, failingPlans: 1 });
    });

    it('says nothing at all when there is nothing to poll', async () => {
      await db.delete(wantedItems);

      expect((await summary()).sources).toEqual([]);
    });
  });

  describe('worker liveness', () => {
    it('is fresh within the window and stale beyond it', async () => {
      await db.insert(processHeartbeat).values([
        { role: 'api', lastSeenAt: new Date(NOW.getTime() - 60_000) },
        { role: 'worker', lastSeenAt: new Date(NOW.getTime() - 20 * 60_000) },
      ]);

      const { workers } = await summary();

      expect(workers).toEqual([
        { role: 'api', lastSeenAt: new Date(NOW.getTime() - 60_000), stale: false },
        { role: 'worker', lastSeenAt: new Date(NOW.getTime() - 20 * 60_000), stale: true },
      ]);
    });

    it('reports none when nothing has ever checked in', async () => {
      expect((await summary()).workers).toEqual([]);
    });
  });

  it('says which zone today was read in, so the page can name the day', async () => {
    expect((await summary()).timezone).toBe('Europe/London');
  });
});
