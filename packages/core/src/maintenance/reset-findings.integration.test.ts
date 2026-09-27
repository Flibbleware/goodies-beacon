import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  candidates,
  categories,
  costLedger,
  events,
  listings,
  media,
  searchPlanState,
  seen,
  sharedCriteria,
  specVersions,
  wantedItems,
} from '../db/schema.js';
import { storeImage } from '../media/ingest.js';
import { resetFindings } from './reset-findings.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;
let mediaDir = '';

afterAll(async () => {
  await pool?.end();
  if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
});

async function picture(shade: number): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: shade, g: 90, b: 40 } },
  })
    .png()
    .toBuffer();
}

const exists = (file: string) =>
  access(join(mediaDir, file)).then(
    () => true,
    () => false,
  );

/**
 * One item with a history: a candidate on a listing, three listing photos (one only the listing
 * uses, one the spec also uses as a reference, one the item uses as its display image), spend in
 * the ledger, a budget event, and two plans — one that has polled and one that never has.
 */
async function seedInstance() {
  const [onlyListing, alsoReference, alsoDisplay] = await Promise.all(
    [10, 120, 230].map(async (shade) =>
      storeImage({ db, mediaDir, kind: 'listing', body: await picture(shade) }),
    ),
  );
  if (!onlyListing || !alsoReference || !alsoDisplay) throw new Error('could not store images');

  const [item] = await db
    .insert(wantedItems)
    .values({ title: 'Carmageddon', status: 'active', displayImageId: alsoDisplay.id })
    .returning({ id: wantedItems.id });
  if (!item) throw new Error('could not seed the item');

  const [version] = await db
    .insert(specVersions)
    .values({
      wantedItemId: item.id,
      version: 1,
      createdBy: 'manual_edit',
      summary: 'Carmageddon big box',
      settings: { sources: ['ebay'], listingTypes: ['auction', 'fixed'] },
      searchPlans: [
        { id: 'plan-polled', source: 'ebay', query: 'carmageddon', region: 'EBAY_GB' },
        { id: 'plan-never', source: 'ebay', query: 'carmageddon mac', region: 'EBAY_GB' },
      ],
      referenceImages: [
        { id: alsoReference.id, path: alsoReference.path, label: 'Mac box', addedAt: new Date() },
      ],
    })
    .returning({ id: specVersions.id });
  if (!version) throw new Error('could not seed the spec version');
  await db
    .update(wantedItems)
    .set({ currentSpecVersionId: version.id })
    .where(eq(wantedItems.id, item.id));

  const [listing] = await db
    .insert(listings)
    .values({
      source: 'ebay',
      externalId: 'v1|123|0',
      url: 'https://www.ebay.co.uk/itm/123',
      title: 'Carmageddon big box',
      images: [onlyListing, alsoReference, alsoDisplay].map((row) => ({
        url: row.sourceUrl ?? 'https://i.ebayimg.com/x.jpg',
        mediaId: row.id,
      })),
    })
    .returning({ id: listings.id });
  if (!listing) throw new Error('could not seed the listing');

  await db.insert(seen).values({ source: 'ebay', externalId: 'v1|123|0' });
  await db.insert(candidates).values({
    wantedItemId: item.id,
    listingId: listing.id,
    specVersionId: version.id,
    searchPlanId: 'plan-polled',
    retain: true,
  });
  await db.insert(costLedger).values([
    { role: 'prefilter', provider: 'google', model: 'gemini-flash-lite', costUsd: '0.000200' },
    { role: 'reviewer', provider: 'openai', model: 'gpt-5-mini', costUsd: '0.004100' },
  ]);
  await db.insert(events).values({
    kind: 'budget_exceeded',
    dedupeKey: '2026-09',
    message: 'The monthly AI budget is spent.',
  });
  await db.insert(searchPlanState).values({
    planId: 'plan-polled',
    wantedItemId: item.id,
    source: 'ebay',
    watermark: new Date('2026-09-01T00:00:00Z'),
    backlogFrom: new Date('2026-08-01T00:00:00Z'),
    backlogUntil: new Date('2026-08-15T00:00:00Z'),
    lastRunAt: new Date('2026-09-20T00:00:00Z'),
    lastSuccessAt: new Date('2026-09-20T00:00:00Z'),
    lastError: 'HTTP 503',
    candidatesFound: 12,
    candidatesReviewed: 9,
    candidatesMatched: 2,
    candidatesUncertain: 3,
    prefilterCostUsd: '0.001200',
  });

  return { item, version, onlyListing, alsoReference, alsoDisplay };
}

describe.skipIf(!databaseUrl)('resetting what the instance has found', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
    mediaDir = await mkdtemp(join(tmpdir(), 'gb-reset-'));
  });

  beforeEach(async () => {
    await db.delete(candidates);
    await db.delete(listings);
    await db.delete(seen);
    await db.delete(costLedger);
    await db.delete(events);
    await db.delete(searchPlanState);
    await db.update(wantedItems).set({ currentSpecVersionId: null, displayImageId: null });
    await db.delete(specVersions);
    await db.delete(wantedItems);
    await db.delete(media);
    await db.delete(sharedCriteria);
    await db.delete(categories);
  });

  it('previews exact counts and changes nothing', async () => {
    const seeded = await seedInstance();

    const summary = await resetFindings(db, { mediaDir, apply: false });

    expect(summary).toMatchObject({
      candidates: 1,
      listings: 1,
      seen: 1,
      listingImages: 1,
      costRows: 2,
      budgetEvents: 1,
      plans: 2,
      filesRemoved: 0,
    });
    expect(summary.spend.allTimeUsd).toBe('0.004300');
    expect(await db.select().from(candidates)).toHaveLength(1);
    expect(await db.select().from(costLedger)).toHaveLength(2);
    expect(await exists(seeded.onlyListing.path)).toBe(true);
  });

  it('clears what was found, keeps what was asked for, and starts every plan from now', async () => {
    const seeded = await seedInstance();
    const [category] = await db
      .insert(categories)
      .values({ name: 'Games', icon: 'gamepad', colour: 'violet' })
      .returning({ id: categories.id });
    await db
      .insert(sharedCriteria)
      .values({ key: 'original-release', text: 'The original release' });
    const before = Date.now();

    const summary = await resetFindings(db, { mediaDir, apply: true });

    expect(summary.filesRemoved).toBe(2);
    for (const table of [candidates, listings, seen, costLedger, events]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }

    // The photo only the listing used is gone, row and files; the two the item uses are not.
    const remaining = await db.select({ id: media.id }).from(media);
    expect(remaining.map((row) => row.id).sort()).toEqual(
      [seeded.alsoReference.id, seeded.alsoDisplay.id].sort(),
    );
    expect(await exists(seeded.onlyListing.path)).toBe(false);
    expect(await exists(seeded.alsoReference.path)).toBe(true);

    const [item] = await db.select().from(wantedItems);
    expect(item).toMatchObject({
      status: 'active',
      currentSpecVersionId: seeded.version.id,
      displayImageId: seeded.alsoDisplay.id,
    });
    expect(await db.select().from(specVersions)).toHaveLength(1);
    expect(await db.select().from(categories)).toEqual([
      expect.objectContaining({ id: category?.id }),
    ]);
    expect(await db.select().from(sharedCriteria)).toHaveLength(1);

    const plans = await db.select().from(searchPlanState).orderBy(searchPlanState.planId);
    expect(plans.map((plan) => plan.planId)).toEqual(['plan-never', 'plan-polled']);
    for (const plan of plans) {
      expect(plan.watermark?.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(plan).toMatchObject({
        backlogFrom: null,
        backlogUntil: null,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        candidatesFound: 0,
        candidatesReviewed: 0,
        candidatesMatched: 0,
        candidatesUncertain: 0,
        prefilterCostUsd: '0.000000',
      });
    }
  });
});
