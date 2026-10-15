import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, AvailabilityQuery, SourceAdapter } from '../adapter/types.js';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { candidates, listings, seen, verdicts, wantedItems } from '../db/schema.js';
import type { ListingAvailability, VerdictDecision } from '../domain/constants.js';
import { itemSaveSchema } from '../items/schema.js';
import { createItem } from '../items/store.js';
import { createSilentLogger } from '../logger.js';
import type { SourceId } from '../sources.js';
import { runAvailabilityCheck } from './check.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const logger = createSilentLogger();
const ctx = {} as AdapterContext;

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

interface SeedOptions {
  /** Oldest first; the newest is the one that counts. Empty is a candidate still queued. */
  decisions?: VerdictDecision[];
  source?: SourceId;
  checkedAt?: Date | null;
}

async function seed(options: SeedOptions = {}): Promise<string> {
  sequence += 1;
  const externalId = `listing-${sequence}`;

  const [listing] = await db
    .insert(listings)
    .values({
      source: options.source ?? 'ebay',
      externalId,
      url: `https://example.com/${sequence}`,
      title: 'Carmageddon big box',
      buyingType: 'fixed',
      availabilityCheckedAt: options.checkedAt ?? null,
    })
    .returning({ id: listings.id });
  if (!listing) throw new Error('could not seed the listing');

  const [candidate] = await db
    .insert(candidates)
    .values({ wantedItemId: itemId, listingId: listing.id, specVersionId, origin: 'poll' })
    .returning({ id: candidates.id });
  if (!candidate) throw new Error('could not seed the candidate');

  for (const [index, decision] of (options.decisions ?? ['match']).entries()) {
    await db.insert(verdicts).values({
      candidateId: candidate.id,
      specVersionId,
      decision,
      criteriaResults: [],
      createdAt: new Date(Date.now() + index * 1000),
    });
  }

  return externalId;
}

function adapterAnswering(
  answer: (listing: AvailabilityQuery) => ListingAvailability | Promise<ListingAvailability>,
) {
  const checkAvailability = vi.fn(async (listing: AvailabilityQuery) => answer(listing));
  return { adapter: { checkAvailability } as unknown as SourceAdapter, checkAvailability };
}

async function stored(externalId: string) {
  const [row] = await db.select().from(listings).where(eq(listings.externalId, externalId));
  if (!row) throw new Error(`no listing ${externalId}`);
  return row;
}

const asked = (spy: ReturnType<typeof adapterAnswering>['checkAvailability']) =>
  spy.mock.calls.map(([listing]) => listing.externalId);

describe.skipIf(!databaseUrl)('the availability check against a real Postgres', () => {
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
    sequence = 0;

    const created = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Carmageddon big box', spec: carmageddon() }),
    );
    itemId = created.itemId;
    specVersionId = created.versionId;
  });

  it('asks about matches and uncertain verdicts on its own source, by the newest verdict', async () => {
    const match = await seed({ decisions: ['match'] });
    const uncertain = await seed({ decisions: ['uncertain'] });
    await seed({ decisions: ['reject'] });
    await seed({ decisions: [] });
    await seed({ decisions: ['match', 'reject'] });
    const rereviewed = await seed({ decisions: ['reject', 'match'] });
    await seed({ decisions: ['match'], source: 'vinted' });
    const { adapter, checkAvailability } = adapterAnswering(() => 'available');

    await runAvailabilityCheck({ db, source: 'ebay', adapter, ctx, logger });

    expect(asked(checkAvailability).sort()).toEqual([match, uncertain, rereviewed].sort());
  });

  it('records a sale or an end with when it was found, and never asks about it again', async () => {
    const sold = await seed();
    const ended = await seed();
    const live = await seed();
    const at = new Date('2026-10-15T14:00:00Z');
    const answers: Record<string, ListingAvailability> = {
      [sold]: 'sold',
      [ended]: 'ended',
      [live]: 'available',
    };
    const first = adapterAnswering((listing) => answers[listing.externalId] ?? 'available');

    const outcome = await runAvailabilityCheck({
      db,
      source: 'ebay',
      adapter: first.adapter,
      ctx,
      logger,
      now: () => at,
    });

    expect(outcome).toEqual({ checked: 3, sold: 1, ended: 1, failed: 0 });
    expect(await stored(sold)).toMatchObject({
      availability: 'sold',
      unavailableAt: at,
      availabilityCheckedAt: at,
    });
    expect(await stored(ended)).toMatchObject({ availability: 'ended', unavailableAt: at });
    expect(await stored(live)).toMatchObject({
      availability: 'available',
      unavailableAt: null,
      availabilityCheckedAt: at,
    });

    const second = adapterAnswering(() => 'available');
    await runAvailabilityCheck({ db, source: 'ebay', adapter: second.adapter, ctx, logger });
    expect(asked(second.checkAvailability)).toEqual([live]);
  });

  it('asks the never-checked first and then the longest unchecked, up to the limit', async () => {
    const recent = await seed({ checkedAt: new Date('2026-10-15T12:00:00Z') });
    const older = await seed({ checkedAt: new Date('2026-10-15T10:00:00Z') });
    const never = await seed({ checkedAt: null });
    const { adapter, checkAvailability } = adapterAnswering(() => 'available');

    await runAvailabilityCheck({ db, source: 'ebay', adapter, ctx, logger, limit: 2 });

    expect(asked(checkAvailability)).toEqual([never, older]);
    expect((await stored(recent)).availabilityCheckedAt).toEqual(new Date('2026-10-15T12:00:00Z'));
  });

  it('goes on past a listing it could not ask about, leaving it available but checked', async () => {
    const broken = await seed();
    const sold = await seed();
    const { adapter } = adapterAnswering((listing) => {
      if (listing.externalId === broken) throw new Error('HTTP 500');
      return 'sold';
    });

    const outcome = await runAvailabilityCheck({ db, source: 'ebay', adapter, ctx, logger });

    expect(outcome).toEqual({ checked: 1, sold: 1, ended: 0, failed: 1 });
    expect(await stored(broken)).toMatchObject({ availability: 'available', unavailableAt: null });
    expect((await stored(broken)).availabilityCheckedAt).not.toBeNull();
    expect((await stored(sold)).availability).toBe('sold');
  });

  it('fails the run when every listing failed, since that is the source and not a listing', async () => {
    await seed();
    await seed();
    const { adapter } = adapterAnswering(() => {
      throw new Error('eBay getItem failed: HTTP 401');
    });

    await expect(
      runAvailabilityCheck({ db, source: 'ebay', adapter, ctx, logger }),
    ).rejects.toThrow('HTTP 401');
  });

  it('does nothing for a source whose adapter cannot answer', async () => {
    await seed();

    const outcome = await runAvailabilityCheck({
      db,
      source: 'ebay',
      adapter: {} as SourceAdapter,
      ctx,
      logger,
    });

    expect(outcome).toEqual({ checked: 0, sold: 0, ended: 0, failed: 0 });
  });
});
