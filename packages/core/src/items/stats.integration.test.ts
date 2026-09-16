import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  candidates,
  listings,
  searchPlanState,
  seen,
  verdicts,
  wantedItems,
} from '../db/schema.js';
import type { VerdictDecision } from '../domain/constants.js';
import { recordPrefilterCost, recordReviewedCandidate } from '../poll/stats.js';
import { itemSaveSchema, summarisePollState } from './schema.js';
import { candidateCounts, planStats, pollStates } from './stats.js';
import { createItem, listItems, loadItem } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

const carmageddon = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL('../domain/fixtures/carmageddon.json', import.meta.url), 'utf8'));

/** The three plan ids the Carmageddon example carries, in the order it lists them. */
const PLAN = 'ebay-gb-carmageddon';

async function seedItem(): Promise<{ itemId: string; specVersionId: string }> {
  const spec = carmageddon();
  const { itemId, versionId } = await createItem(
    db,
    itemSaveSchema.parse({ title: 'Carmageddon big box', status: 'active', spec }),
  );
  return { itemId, specVersionId: versionId };
}

async function seedCandidate(
  itemId: string,
  specVersionId: string,
  externalId: string,
  planId: string | null,
  decision?: VerdictDecision,
): Promise<string> {
  const [listing] = await db
    .insert(listings)
    .values({
      source: 'ebay',
      externalId,
      url: `https://example.com/${externalId}`,
      title: 'Carmageddon big box',
    })
    .returning({ id: listings.id });
  if (!listing) throw new Error('could not seed the listing');

  const [candidate] = await db
    .insert(candidates)
    .values({ wantedItemId: itemId, listingId: listing.id, specVersionId, searchPlanId: planId })
    .returning({ id: candidates.id });
  if (!candidate) throw new Error('could not seed the candidate');

  if (decision) {
    await db.insert(verdicts).values({
      candidateId: candidate.id,
      specVersionId,
      decision,
      criteriaResults: [],
    });
  }

  return candidate.id;
}

async function seedPlanState(itemId: string, planId: string): Promise<void> {
  await db
    .insert(searchPlanState)
    .values({ planId, wantedItemId: itemId, source: 'ebay' })
    .onConflictDoNothing();
}

describe.skipIf(!databaseUrl)('the item stats against a real Postgres', () => {
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
  });

  describe('candidate counts', () => {
    it('counts a candidate with no verdict as waiting rather than as nothing', async () => {
      const { itemId, specVersionId } = await seedItem();
      await seedCandidate(itemId, specVersionId, 'a', PLAN);
      await seedCandidate(itemId, specVersionId, 'b', PLAN, 'match');

      const counts = (await candidateCounts(db)).get(itemId);

      expect(counts).toEqual({
        candidates: 2,
        matched: 1,
        uncertain: 0,
        rejected: 0,
        pending: 1,
      });
    });

    /**
     * §4 makes re-reviews append and the newest authoritative. Counting every verdict row would
     * show one re-reviewed candidate as both a rejection and a match, and the numbers would add
     * up to more candidates than exist.
     */
    it('reads only each candidate’s newest verdict', async () => {
      const { itemId, specVersionId } = await seedItem();
      const candidateId = await seedCandidate(itemId, specVersionId, 'a', PLAN, 'reject');

      await db.insert(verdicts).values({
        candidateId,
        specVersionId,
        decision: 'match',
        criteriaResults: [],
        createdAt: new Date(Date.now() + 1000),
      });

      const counts = (await candidateCounts(db)).get(itemId);

      expect(counts).toMatchObject({ candidates: 1, matched: 1, rejected: 0 });
    });

    it('answers for one item when asked for one', async () => {
      const first = await seedItem();
      const second = await seedItem();
      await seedCandidate(first.itemId, first.specVersionId, 'a', PLAN, 'match');
      await seedCandidate(second.itemId, second.specVersionId, 'b', PLAN, 'reject');

      const only = await candidateCounts(db, first.itemId);

      expect([...only.keys()]).toEqual([first.itemId]);
      expect(only.get(first.itemId)).toMatchObject({ matched: 1 });
    });
  });

  describe('the review worker’s half of the plan stats', () => {
    it('counts a reviewed candidate and what the rules made of it', async () => {
      const { itemId } = await seedItem();
      await seedPlanState(itemId, PLAN);

      await recordReviewedCandidate(db, PLAN, 'match');
      await recordReviewedCandidate(db, PLAN, 'uncertain');
      await recordReviewedCandidate(db, PLAN, 'reject');

      const [row] = await db.select().from(searchPlanState).where(eq(searchPlanState.planId, PLAN));

      expect(row?.candidatesReviewed).toBe(3);
      expect(row?.candidatesMatched).toBe(1);
      expect(row?.candidatesUncertain).toBe(1);
    });

    /**
     * Every pre-filter call is billed, so every call is counted. Charging only the discards would
     * make a query whose listings are all plausible show a cost of zero while paying for one call
     * each — exactly backwards from "is this query earning its keep".
     */
    it('charges the plan for a pre-filter call whichever way it went', async () => {
      const { itemId } = await seedItem();
      await seedPlanState(itemId, PLAN);

      await recordPrefilterCost(db, PLAN, 0.000021);
      await recordPrefilterCost(db, PLAN, 0.000034);

      const [row] = await db.select().from(searchPlanState).where(eq(searchPlanState.planId, PLAN));

      expect(Number(row?.prefilterCostUsd)).toBeCloseTo(0.000055, 6);
    });

    it('does nothing for a candidate that came from no plan', async () => {
      const { itemId } = await seedItem();
      await seedPlanState(itemId, PLAN);

      await recordReviewedCandidate(db, null, 'match');
      await recordPrefilterCost(db, null, 0.5);

      const [row] = await db.select().from(searchPlanState).where(eq(searchPlanState.planId, PLAN));

      expect(row?.candidatesReviewed).toBe(0);
      expect(Number(row?.prefilterCostUsd)).toBe(0);
    });
  });

  describe('the plan table', () => {
    it('lists every plan in the spec, including ones that have never run', async () => {
      const { itemId } = await seedItem();
      const spec = carmageddon();

      const plans = await planStats(db, itemId, spec.searchPlans as unknown[]);

      expect(plans.map((plan) => plan.planId)).toEqual([
        'ebay-gb-carmageddon',
        'ebay-us-carmageddon',
        'ebay-gb-carmageddon-big-box',
      ]);
      expect(plans.every((plan) => plan.inSpec)).toBe(true);
      expect(plans[0]).toMatchObject({ candidatesFound: 0, lastRunAt: null, query: 'carmageddon' });
    });

    /**
     * A query taken out of the spec keeps its stats and is shown, because the candidates it found
     * are still here and "that one was dropped for finding nothing" is worth being able to see.
     */
    it('keeps a plan that has state but is no longer in the spec, marked as such', async () => {
      const { itemId } = await seedItem();
      await seedPlanState(itemId, 'ebay-gb-retired');

      const plans = await planStats(db, itemId, []);

      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ planId: 'ebay-gb-retired', inSpec: false, enabled: false });
    });
  });

  describe('when an item last polled', () => {
    it('reports never for an item whose plans have not run', async () => {
      const { itemId } = await seedItem();

      expect((await pollStates(db)).get(itemId)).toBeUndefined();
      expect((await loadItem(db, itemId))?.lastPollAt).toBeNull();
    });

    /**
     * The list computes this in SQL over every item and the page computes it from the plan rows
     * it already holds. Two implementations of one rule, so they are asserted to agree.
     */
    it('agrees between the list and the item page, failing plans included', async () => {
      const { itemId } = await seedItem();
      await seedPlanState(itemId, PLAN);
      await seedPlanState(itemId, 'ebay-us-carmageddon');

      const succeeded = new Date('2026-09-15T08:00:00.000Z');
      const failed = new Date('2026-09-16T08:00:00.000Z');
      await db
        .update(searchPlanState)
        .set({ lastRunAt: succeeded, lastSuccessAt: succeeded })
        .where(eq(searchPlanState.planId, PLAN));
      await db
        .update(searchPlanState)
        .set({ lastRunAt: failed, lastError: 'eBay said 503' })
        .where(eq(searchPlanState.planId, 'ebay-us-carmageddon'));

      const fromList = (await pollStates(db)).get(itemId);
      const page = await loadItem(db, itemId);
      const fromPage = summarisePollState(page?.plans ?? []);

      expect(fromList).toEqual(fromPage);
      expect(fromPage).toEqual({
        lastPollAt: failed,
        lastSuccessAt: succeeded,
        failingPlans: 1,
      });
    });
  });

  it('puts the counts and the poll state on the list as well as the page', async () => {
    const { itemId, specVersionId } = await seedItem();
    await seedPlanState(itemId, PLAN);
    await seedCandidate(itemId, specVersionId, 'a', PLAN, 'uncertain');

    const [row] = await listItems(db);

    expect(row?.counts).toMatchObject({ candidates: 1, uncertain: 1 });
    expect(row?.failingPlans).toBe(0);
    expect(row?.lastPollAt).toBeNull();
  });
});
