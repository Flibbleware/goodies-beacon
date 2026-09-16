import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { candidates, listings, seen, verdicts, wantedItems } from '../db/schema.js';
import type { CandidateOrigin, RejectionReason, VerdictDecision } from '../domain/constants.js';
import { itemSaveSchema } from '../items/schema.js';
import { createItem } from '../items/store.js';
import { candidateFilterSchema } from './schema.js';
import { listCandidates, loadCandidate, setRetain } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;
let itemId: string;
let specVersionId: string;

afterAll(async () => {
  await pool?.end();
});

const carmageddon = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL('../domain/fixtures/carmageddon.json', import.meta.url), 'utf8'));

const filter = (overrides: Record<string, unknown> = {}) =>
  candidateFilterSchema.parse({ wantedItemId: itemId, ...overrides });

interface SeedOptions {
  decision?: VerdictDecision;
  reason?: RejectionReason;
  origin?: CandidateOrigin;
  title?: string;
  mediaId?: string | null;
  criteriaResults?: unknown[];
  promptText?: string;
  promptImages?: unknown[];
}

let sequence = 0;

async function seed(options: SeedOptions = {}): Promise<string> {
  sequence += 1;

  const [listing] = await db
    .insert(listings)
    .values({
      source: 'ebay',
      externalId: `listing-${sequence}`,
      url: `https://example.com/${sequence}`,
      title: options.title ?? 'Carmageddon big box',
      priceAmount: '120.00',
      priceCurrency: 'USD',
      priceGbp: '95.00',
      buyingType: 'fixed',
      itemLocationCountry: 'US',
      shipsToUk: 'yes',
      images: [
        { url: 'https://example.com/a.jpg', mediaId: options.mediaId ?? null },
        { url: 'https://example.com/b.jpg', mediaId: null },
      ],
    })
    .returning({ id: listings.id });
  if (!listing) throw new Error('could not seed the listing');

  const [candidate] = await db
    .insert(candidates)
    .values({
      wantedItemId: itemId,
      listingId: listing.id,
      specVersionId,
      origin: options.origin ?? 'poll',
      stage: options.decision ? 'reviewed' : 'new',
      // Keeps the list's ordering deterministic without sleeping between inserts.
      createdAt: new Date(Date.now() + sequence * 1000),
    })
    .returning({ id: candidates.id });
  if (!candidate) throw new Error('could not seed the candidate');

  if (options.decision) {
    await db.insert(verdicts).values({
      candidateId: candidate.id,
      specVersionId,
      decision: options.decision,
      reason: options.reason ?? null,
      criteriaResults: options.criteriaResults ?? [],
      englishSummary: 'A complete big box copy.',
      model: 'openai:gpt-5-mini',
      promptText: options.promptText ?? null,
      promptImages: options.promptImages ?? null,
      inputTokens: 4000,
      outputTokens: 200,
      costUsd: '0.004000',
    });
  }

  return candidate.id;
}

describe.skipIf(!databaseUrl)('the candidate store against a real Postgres', () => {
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

  describe('the list', () => {
    it('shows the newest first with its verdict, price and provenance', async () => {
      await seed({ decision: 'reject' });
      await seed({ decision: 'match', title: 'Carmageddon Mac big box' });

      const { rows, total } = await listCandidates(db, filter());

      expect(total).toBe(2);
      expect(rows[0]?.listing.title).toBe('Carmageddon Mac big box');
      expect(rows[0]).toMatchObject({
        decision: 'match',
        itemTitle: 'Carmageddon big box',
        origin: 'poll',
      });
      expect(rows[0]?.listing).toMatchObject({
        priceGbp: '95.00',
        priceAmount: '120.00',
        priceCurrency: 'USD',
        shipsToUk: 'yes',
        itemLocationCountry: 'US',
      });
    });

    /**
     * Requirement 6. A rejection is read by the same path as a match, so filtering to them is one
     * value rather than a different query with different fields.
     */
    it('browses rejections exactly as it browses matches', async () => {
      await seed({ decision: 'match' });
      await seed({ decision: 'reject', reason: 'prefilter' });
      await seed({ decision: 'reject', reason: 'over_budget' });

      const rejected = await listCandidates(db, filter({ decision: 'reject' }));
      const matched = await listCandidates(db, filter({ decision: 'match' }));

      expect(rejected.total).toBe(2);
      expect(rejected.rows.map((row) => row.reason)).toEqual(['over_budget', 'prefilter']);
      expect(matched.total).toBe(1);
      expect(Object.keys(rejected.rows[0] ?? {}).sort()).toEqual(
        Object.keys(matched.rows[0] ?? {}).sort(),
      );
    });

    it('finds the ones nothing has judged yet', async () => {
      await seed({ decision: 'match' });
      await seed();

      const { rows, total } = await listCandidates(db, filter({ decision: 'pending' }));

      expect(total).toBe(1);
      expect(rows[0]?.decision).toBeNull();
      expect(rows[0]?.stage).toBe('new');
    });

    it('filters by origin, so a backfill sweep can be told from the daily polls', async () => {
      await seed({ decision: 'match', origin: 'poll' });
      await seed({ decision: 'match', origin: 'backfill' });

      expect((await listCandidates(db, filter({ origin: 'backfill' }))).total).toBe(1);
      expect((await listCandidates(db, filter({ origin: 'poll' }))).total).toBe(1);
      expect((await listCandidates(db, filter())).total).toBe(2);
    });

    /** §4 makes re-reviews append and the newest authoritative, so the filter must read that one. */
    it('filters on the newest verdict rather than on any verdict', async () => {
      const candidateId = await seed({ decision: 'reject' });
      await db.insert(verdicts).values({
        candidateId,
        specVersionId,
        decision: 'match',
        criteriaResults: [],
        createdAt: new Date(Date.now() + 60_000),
      });

      expect((await listCandidates(db, filter({ decision: 'reject' }))).total).toBe(0);
      expect((await listCandidates(db, filter({ decision: 'match' }))).total).toBe(1);
    });

    it('pages without losing the total', async () => {
      for (let n = 0; n < 5; n += 1) await seed({ decision: 'match' });

      const page = await listCandidates(db, filter({ limit: 2, offset: 2 }));

      expect(page.total).toBe(5);
      expect(page.rows).toHaveLength(2);
    });

    /**
     * An image whose fetch P1-05's guard refused has no `mediaId`, and the page has nothing to
     * show for it. It must not fall back to the marketplace's own URL, which would move the SSRF
     * the guard exists to prevent into the browser.
     */
    it('offers only the photographs this instance actually stored', async () => {
      await seed({ decision: 'match', mediaId: '11111111-1111-4111-8111-111111111111' });

      const { rows } = await listCandidates(db, filter());

      expect(rows[0]?.listing.images).toEqual(['11111111-1111-4111-8111-111111111111']);
    });
  });

  describe('the candidate page', () => {
    it('pairs each result with the criterion that was asked', async () => {
      const candidateId = await seed({
        decision: 'uncertain',
        criteriaResults: [
          { criterionId: 'big-box', result: 'pass', evidence: 'the box is pictured' },
          { criterionId: 'contents-complete', result: 'unknown', evidence: 'contents not shown' },
        ],
      });

      const detail = await loadCandidate(db, candidateId);
      const [verdict] = detail?.verdicts ?? [];

      expect(detail?.specVersion).toBe(1);
      expect(verdict?.criteriaResults[0]?.criterion?.text).toBe(
        'Big box release, not the jewel case or budget re-release',
      );
      expect(verdict?.criteriaResults[1]?.result).toBe('unknown');
    });

    /**
     * `reasons` is derived, never stored (see verdict.ts): the rules are pure and the spec version
     * is immutable, so re-running them reproduces exactly what they said.
     */
    it('puts the rules’ reasons back without having stored them', async () => {
      const candidateId = await seed({
        decision: 'uncertain',
        criteriaResults: [
          { criterionId: 'contents-complete', result: 'unknown', evidence: 'contents not shown' },
        ],
      });

      const detail = await loadCandidate(db, candidateId);
      const reasons = detail?.verdicts[0]?.reasons ?? [];

      // Named by their text, as P1-11 writes them, and covering the criteria the model did not
      // answer as well as the one it did — an unanswered criterion is unknown, never a pass.
      expect(reasons.join(' ')).toContain('Box, manual and disc are all present');
      expect(reasons).toHaveLength((carmageddon().criteria as unknown[]).length);
    });

    /** A hard filter stopped it before any criterion was asked; its own reason is the explanation. */
    it('leaves the rules out of a verdict no criterion reached', async () => {
      const candidateId = await seed({ decision: 'reject', reason: 'over_budget' });

      const detail = await loadCandidate(db, candidateId);

      expect(detail?.verdicts[0]?.reason).toBe('over_budget');
      expect(detail?.verdicts[0]?.reasons).toEqual([]);
      expect(detail?.verdicts[0]?.criteriaResults).toEqual([]);
    });

    it('reads back the exact prompt and the exact images that were sent', async () => {
      const candidateId = await seed({
        decision: 'match',
        promptText: 'SYSTEM\n\n# The listing\nCarmageddon',
        promptImages: [
          { mediaId: '22222222-2222-4222-8222-222222222222', label: 'front', kind: 'reference' },
          { mediaId: '33333333-3333-4333-8333-333333333333', label: '', kind: 'listing' },
          { label: 'no media id', kind: 'listing' },
        ],
      });

      const detail = await loadCandidate(db, candidateId);
      const [verdict] = detail?.verdicts ?? [];

      expect(verdict?.promptText).toBe('SYSTEM\n\n# The listing\nCarmageddon');
      // The third has no media id, so there is no image to show for it.
      expect(verdict?.promptImages).toEqual([
        { mediaId: '22222222-2222-4222-8222-222222222222', label: 'front', kind: 'reference' },
        { mediaId: '33333333-3333-4333-8333-333333333333', label: '', kind: 'listing' },
      ]);
    });

    it('lists re-reviews newest first and keeps the earlier ones', async () => {
      const candidateId = await seed({ decision: 'reject' });
      await db.insert(verdicts).values({
        candidateId,
        specVersionId,
        decision: 'match',
        criteriaResults: [],
        createdAt: new Date(Date.now() + 60_000),
      });

      const detail = await loadCandidate(db, candidateId);

      expect(detail?.verdicts.map((verdict) => verdict.decision)).toEqual(['match', 'reject']);
    });

    it('answers with nothing for a candidate that does not exist', async () => {
      expect(await loadCandidate(db, '00000000-0000-4000-8000-000000000000')).toBeUndefined();
    });
  });

  describe('retain', () => {
    it('toggles and is visible on the list', async () => {
      const candidateId = await seed({ decision: 'match' });

      expect(await setRetain(db, candidateId, true)).toBe(true);
      expect((await loadCandidate(db, candidateId))?.retain).toBe(true);
      expect((await listCandidates(db, filter({ retained: true }))).total).toBe(1);

      expect(await setRetain(db, candidateId, false)).toBe(false);
      expect((await listCandidates(db, filter({ retained: true }))).total).toBe(0);
    });

    it('answers with nothing for a candidate that does not exist', async () => {
      expect(await setRetain(db, '00000000-0000-4000-8000-000000000000', true)).toBeUndefined();
    });
  });
});
