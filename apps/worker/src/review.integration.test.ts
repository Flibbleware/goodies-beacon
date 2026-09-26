import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Converter,
  candidates,
  costLedger,
  createDb,
  createPool,
  createSilentLogger,
  type Database,
  listings,
  media,
  type NotificationMessage,
  notifications,
  type ReviewPortRequest,
  type ReviewPortResult,
  type ReviewPorts,
  runMigrations,
  runReview,
  searchPlanState,
  specVersions,
  verdicts,
  wantedItems,
} from '@goodies-beacon/core';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * P1-12's acceptance test: one candidate through every stage of §7, against a real database.
 *
 * The AI is a fake port rather than a fake provider key — the same seam the worker uses to wire
 * the real one — because what is under test here is the *pipeline*: which stages run, what stops
 * it early, what gets stored, what gets sent, and what a retry does. Whether the prompts make
 * good judgements is measured against real models by the two check scripts.
 *
 * It lives in apps/worker for the same reason P1-07's does: core cannot depend on a source
 * package without a cycle.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const logger = createSilentLogger();

let pool: Pool | undefined;
let db: Database;
let mediaDir: string;

afterAll(async () => {
  await pool?.end();
  if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
});

const converter: Converter = {
  async toGbp(amount) {
    return { amountGbp: amount, rateDate: null };
  },
  invalidate() {},
};

interface Spy {
  prefilterCalls: number;
  reviewCalls: number;
  enrichCalls: number;
  emails: NotificationMessage[];
}

/** A fake AI: plausible by default, everything passing, and counting what it was asked. */
function fakePorts(
  overrides: {
    plausible?: boolean;
    reviewResult?: Partial<ReviewPortResult>;
    enrich?: ReviewPorts['enrich'];
    failReview?: Error;
    noEmail?: boolean;
  } = {},
): ReviewPorts & { spy: Spy } {
  const spy: Spy = { prefilterCalls: 0, reviewCalls: 0, enrichCalls: 0, emails: [] };

  const ports: ReviewPorts & { spy: Spy } = {
    spy,
    prefilter: async () => {
      spy.prefilterCalls += 1;
      return {
        plausible: overrides.plausible ?? true,
        reason: overrides.plausible === false ? 'This is a t-shirt, not the game.' : 'Plausible.',
        costUsd: 0.000_02,
        modelRef: 'openai:gpt-5-nano',
        usage: { inputTokens: 800, outputTokens: 30 },
        failedOpen: false,
      };
    },
    review: async () => {
      spy.reviewCalls += 1;
      if (overrides.failReview) throw overrides.failReview;
      return {
        criteriaResults: [
          { criterionId: 'big-box', result: 'pass', evidence: 'the box is pictured' },
        ],
        englishSummary: 'A complete big box copy.',
        shipsToUk: 'yes',
        grade: null,
        promptText: 'SYSTEM\n\n# The listing',
        promptImages: [],
        costUsd: 0.004,
        modelRef: 'openai:gpt-5-mini',
        usage: { inputTokens: 4_000, outputTokens: 200 },
        ...overrides.reviewResult,
      };
    },
    enrich: async (source, listing) => {
      spy.enrichCalls += 1;
      if (overrides.enrich) return overrides.enrich(source, listing);
      return { ...listing, description: 'The full description, fetched by enrichment.' };
    },
  };

  if (!overrides.noEmail) {
    ports.sendEmail = async (message) => {
      spy.emails.push(message);
    };
  }

  return ports;
}

interface SeedOptions {
  priceGbp?: string | null;
  priceCeiling?: { amount: number; currency: 'GBP' } | null;
  negativeKeywords?: string[];
  notificationMode?: 'realtime' | 'digest';
  origin?: 'poll' | 'backfill';
  title?: string;
  /** Set to attribute the candidate to a plan, so P1-14's per-query stats can be asserted. */
  searchPlanId?: string;
  referenceImages?: { id: string; path: string; label: string; addedAt: string }[];
}

/** One wanted item, one spec version, one listing, one candidate ready to review. */
async function seed(options: SeedOptions = {}): Promise<{ candidateId: string; itemId: string }> {
  const [item] = await db
    .insert(wantedItems)
    .values({
      title: 'Carmageddon big box',
      status: 'active',
      notificationMode: options.notificationMode ?? 'realtime',
    })
    .returning({ id: wantedItems.id });
  if (!item) throw new Error('could not seed the item');

  const [version] = await db
    .insert(specVersions)
    .values({
      wantedItemId: item.id,
      version: 1,
      createdBy: 'manual_edit',
      summary: 'Carmageddon, the original 1997 big-box release.',
      settings: {
        sources: ['_template'],
        listingTypes: ['auction', 'fixed'],
        priceCeiling: options.priceCeiling === undefined ? null : options.priceCeiling,
        negativeKeywords: options.negativeKeywords ?? [],
        defaultOnUnknown: 'surface',
      },
      criteria: [
        {
          id: 'big-box',
          text: 'Big box release, not the jewel case',
          kind: 'hard',
          quantifiable: true,
          onUnknown: 'surface',
        },
      ],
      referenceImages: options.referenceImages ?? [],
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
      source: '_template',
      externalId: `item-${crypto.randomUUID()}`,
      url: 'https://fixtures.example.invalid/listing/1',
      title: options.title ?? 'Carmageddon PC CD-ROM big box',
      priceAmount: '25.00',
      priceCurrency: 'GBP',
      priceGbp: options.priceGbp === undefined ? '25.00' : options.priceGbp,
      images: [],
    })
    .returning({ id: listings.id });
  if (!listing) throw new Error('could not seed the listing');

  const [candidate] = await db
    .insert(candidates)
    .values({
      wantedItemId: item.id,
      listingId: listing.id,
      specVersionId: version.id,
      origin: options.origin ?? 'poll',
      searchPlanId: options.searchPlanId ?? null,
    })
    .returning({ id: candidates.id });
  if (!candidate) throw new Error('could not seed the candidate');

  if (options.searchPlanId) {
    await db
      .insert(searchPlanState)
      .values({ planId: options.searchPlanId, wantedItemId: item.id, source: '_template' })
      .onConflictDoNothing();
  }

  return { candidateId: candidate.id, itemId: item.id };
}

/** A media row and a file behind it; the pipeline reads the bytes and nothing checks them. */
async function storedFile(label: string | null): Promise<{ id: string; path: string }> {
  const hash = crypto.randomUUID();
  const path = `test/${hash}.webp`;
  await mkdir(join(mediaDir, 'test'), { recursive: true });
  await writeFile(join(mediaDir, path), hash);
  const [row] = await db
    .insert(media)
    .values({
      kind: 'reference',
      path,
      contentHash: hash,
      contentType: 'image/webp',
      bytes: 36,
      label,
    })
    .returning({ id: media.id });
  if (!row) throw new Error('could not seed the image');
  return { id: row.id, path };
}

function depsWith(ports: ReviewPorts) {
  return { db, logger, converter, ports, mediaDir, host: 'https://beacon.example.invalid' };
}

describe.skipIf(!databaseUrl)('the review pipeline against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
    mediaDir = await mkdtemp(join(tmpdir(), 'goodies-review-'));
  });

  beforeEach(async () => {
    await db.delete(notifications);
    await db.delete(verdicts);
    await db.delete(costLedger);
    await db.delete(candidates);
    await db.delete(listings);
    await db.delete(wantedItems);
  });

  const planRow = async (planId: string) => {
    const [row] = await db.select().from(searchPlanState).where(eq(searchPlanState.planId, planId));
    return row;
  };

  /** The whole of §7 for a candidate that survives every stage. */
  it('runs a candidate through every stage and stores the verdict', async () => {
    const { candidateId } = await seed();
    const ports = fakePorts();

    const outcome = await runReview(depsWith(ports), candidateId);

    expect(outcome).toMatchObject({ status: 'reviewed', decision: 'match', notified: true });
    expect(ports.spy).toMatchObject({ prefilterCalls: 1, reviewCalls: 1, enrichCalls: 1 });

    const [verdict] = await db.select().from(verdicts).where(eq(verdicts.candidateId, candidateId));
    expect(verdict).toMatchObject({
      decision: 'match',
      modelRole: 'reviewer',
      model: 'openai:gpt-5-mini',
      englishSummary: 'A complete big box copy.',
      inputTokens: 4_000,
      outputTokens: 200,
    });
    // "Show prompt" is a read, not a rebuild (P1-10).
    expect(verdict?.promptText).toContain('# The listing');
    expect(Number(verdict?.costUsd)).toBeCloseTo(0.004, 6);

    const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
    expect(candidate?.stage).toBe('reviewed');
    expect(candidate?.error).toBeNull();

    // Enrichment's fuller description is what was stored, not the search result's.
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, candidate?.listingId as string));
    expect(listing?.description).toContain('fetched by enrichment');
  });

  describe('the hard filters, which cost nothing', () => {
    it('rejects a listing over the price ceiling without asking a model', async () => {
      const { candidateId } = await seed({
        priceGbp: '250.00',
        priceCeiling: { amount: 120, currency: 'GBP' },
      });
      const ports = fakePorts();

      const outcome = await runReview(depsWith(ports), candidateId);

      expect(outcome).toMatchObject({ status: 'rejected', reason: 'over_budget' });
      expect(ports.spy).toMatchObject({ prefilterCalls: 0, reviewCalls: 0, enrichCalls: 0 });
      expect(await db.select().from(costLedger)).toHaveLength(0);

      const [verdict] = await db.select().from(verdicts);
      // The model columns stay null: nothing pretends a model was consulted (§7 step 2).
      expect(verdict).toMatchObject({ decision: 'reject', reason: 'over_budget', model: null });
    });

    it('rejects a negative keyword in the title without asking a model', async () => {
      const { candidateId } = await seed({
        title: 'Carmageddon T-Shirt Retro Gaming Tee',
        negativeKeywords: ['t-shirt'],
      });
      const ports = fakePorts();

      const outcome = await runReview(depsWith(ports), candidateId);

      expect(outcome).toMatchObject({ status: 'rejected', reason: 'negative_keyword' });
      expect(ports.spy.prefilterCalls).toBe(0);
      expect(await db.select().from(costLedger)).toHaveLength(0);
    });

    /** §1's asymmetry: a price nobody can read must not silently discard the listing. */
    it('does not apply the ceiling to a price it cannot convert', async () => {
      const { candidateId } = await seed({
        priceGbp: null,
        priceCeiling: { amount: 1, currency: 'GBP' },
      });
      const unconvertible: Converter = {
        async toGbp() {
          return null;
        },
        invalidate() {},
      };

      const outcome = await runReview(
        { ...depsWith(fakePorts()), converter: unconvertible },
        candidateId,
      );

      expect(outcome).toMatchObject({ status: 'reviewed' });
    });
  });

  /** P1-25: the display image is the item's, the pipeline reads the spec, and never the twain. */
  it('sends the reference images to the reviewer and never the display image', async () => {
    const reference = await storedFile('UK big box, front');
    const display = await storedFile(null);
    const { candidateId, itemId } = await seed({
      referenceImages: [
        { ...reference, label: 'UK big box, front', addedAt: new Date().toISOString() },
      ],
    });
    await db
      .update(wantedItems)
      .set({ displayImageId: display.id })
      .where(eq(wantedItems.id, itemId));

    const ports = fakePorts();
    const review = ports.review;
    let sent: ReviewPortRequest | undefined;
    ports.review = async (request) => {
      sent = request;
      return review(request);
    };

    await runReview(depsWith(ports), candidateId);

    expect(sent?.referenceImages.map((image) => image.mediaId)).toEqual([reference.id]);
    expect(sent?.listing.images).toEqual([]);

    await db.delete(wantedItems).where(eq(wantedItems.id, itemId));
    await db.delete(media).where(eq(media.id, reference.id));
    await db.delete(media).where(eq(media.id, display.id));
  });

  it('stops at the pre-filter when the listing is clearly something else', async () => {
    const { candidateId } = await seed();
    const ports = fakePorts({ plausible: false });

    const outcome = await runReview(depsWith(ports), candidateId);

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'prefilter' });
    // The expensive half never ran.
    expect(ports.spy).toMatchObject({ prefilterCalls: 1, reviewCalls: 0, enrichCalls: 0 });

    const [verdict] = await db.select().from(verdicts);
    expect(verdict).toMatchObject({
      decision: 'reject',
      reason: 'prefilter',
      modelRole: 'prefilter',
    });
    expect(verdict?.englishSummary).toContain('t-shirt');
  });

  /** The decision is P1-11's and the reviewer's opinion never reaches the verdict directly. */
  it('stores the decision the rules reached, not one the model offered', async () => {
    const { candidateId } = await seed();
    const ports = fakePorts({
      reviewResult: {
        criteriaResults: [
          { criterionId: 'big-box', result: 'fail', evidence: 'this is a jewel case' },
        ],
      },
    });

    const outcome = await runReview(depsWith(ports), candidateId);

    expect(outcome).toMatchObject({ status: 'reviewed', decision: 'reject' });
    expect(ports.spy.emails).toHaveLength(0);
  });

  describe('re-running a job', () => {
    it('is a no-op for a candidate that already has a verdict', async () => {
      const { candidateId } = await seed();
      const first = fakePorts();
      await runReview(depsWith(first), candidateId);

      const second = fakePorts();
      const outcome = await runReview(depsWith(second), candidateId);

      expect(outcome).toEqual({ status: 'skipped', why: 'already-reviewed' });
      expect(second.spy).toMatchObject({ prefilterCalls: 0, reviewCalls: 0, enrichCalls: 0 });
      expect(await db.select().from(verdicts)).toHaveLength(1);
      expect(await db.select().from(notifications)).toHaveLength(1);
    });

    /**
     * A re-delivered job resumes where the candidate got to. pg-boss delivers at least once, so a
     * job whose worker died after enrichment comes back, and the stage is what stops it paying
     * for the earlier steps again.
     */
    it('resumes at the stage the candidate reached', async () => {
      const { candidateId } = await seed();
      await db.update(candidates).set({ stage: 'enriched' }).where(eq(candidates.id, candidateId));

      const ports = fakePorts();
      const outcome = await runReview(depsWith(ports), candidateId);

      expect(outcome).toMatchObject({ status: 'reviewed', decision: 'match' });
      expect(ports.spy).toMatchObject({ prefilterCalls: 0, enrichCalls: 0, reviewCalls: 1 });
    });

    /**
     * After a *failure* the cheap stages do run again, and that is deliberate rather than an
     * oversight: `stage` holds one value, §4 makes `failed` a terminal state of its own, and
     * recording how far a failed candidate got would need a second column to say it. What that
     * costs is a pre-filter call — a fraction of a penny — and an enrichment fetch whose images
     * dedupe on their content hash. What it must never cost is a second *review*, and it cannot:
     * a review that succeeded has written its verdict and moved the candidate to `reviewed`.
     */
    it('re-runs the cheap stages after a failure, but never a completed review', async () => {
      const { candidateId } = await seed();
      const failing = fakePorts({ failReview: new Error('the provider had a bad minute') });

      await expect(runReview(depsWith(failing), candidateId)).rejects.toThrow('bad minute');
      expect(failing.spy).toMatchObject({ prefilterCalls: 1, enrichCalls: 1, reviewCalls: 1 });

      const retry = fakePorts();
      expect(await runReview(depsWith(retry), candidateId)).toMatchObject({ status: 'reviewed' });
      expect(retry.spy.reviewCalls).toBe(1);

      // The third delivery pays for nothing at all: the review is banked.
      const third = fakePorts();
      expect(await runReview(depsWith(third), candidateId)).toEqual({
        status: 'skipped',
        why: 'already-reviewed',
      });
      expect(third.spy).toMatchObject({ prefilterCalls: 0, enrichCalls: 0, reviewCalls: 0 });
      expect(await db.select().from(verdicts)).toHaveLength(1);
    });
  });

  it('leaves a failure visible on the candidate and rethrows so the job is retried', async () => {
    const { candidateId } = await seed();
    const ports = fakePorts({ failReview: new Error('the provider had a bad minute') });

    await expect(runReview(depsWith(ports), candidateId)).rejects.toThrow('bad minute');

    const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
    expect(candidate?.stage).toBe('failed');
    expect(candidate?.error).toContain('bad minute');
  });

  describe('notification', () => {
    it('sends one plain email for a match on a real-time item from a poll', async () => {
      const { candidateId } = await seed();
      const ports = fakePorts();

      await runReview(depsWith(ports), candidateId);

      expect(ports.spy.emails).toHaveLength(1);
      expect(ports.spy.emails[0]?.subject).toContain('Match');
      expect(ports.spy.emails[0]?.text).toContain('Carmageddon PC CD-ROM big box');
      expect(ports.spy.emails[0]?.text).toContain(candidateId);

      const [row] = await db.select().from(notifications);
      expect(row).toMatchObject({ candidateId, channel: 'realtime' });
      expect(row?.sentAt).not.toBeNull();
    });

    /** §10: an uncertain email says exactly what could not be established. */
    it('names the unknowns in an uncertain email', async () => {
      const { candidateId } = await seed();
      const ports = fakePorts({
        reviewResult: {
          criteriaResults: [
            { criterionId: 'big-box', result: 'unknown', evidence: 'no photo shows the box' },
          ],
        },
      });

      const outcome = await runReview(depsWith(ports), candidateId);

      expect(outcome).toMatchObject({ decision: 'uncertain' });
      expect(ports.spy.emails[0]?.subject).toContain('Possible match');
      expect(ports.spy.emails[0]?.text).toContain('Could not be established');
      expect(ports.spy.emails[0]?.text).toContain('no photo shows the box');
    });

    it('sends nothing for a rejected candidate', async () => {
      const { candidateId } = await seed({ negativeKeywords: ['carmageddon'] });
      const ports = fakePorts();

      await runReview(depsWith(ports), candidateId);

      expect(ports.spy.emails).toHaveLength(0);
      expect(await db.select().from(notifications)).toHaveLength(0);
    });

    it('sends nothing for a digest-mode item', async () => {
      const { candidateId } = await seed({ notificationMode: 'digest' });
      const ports = fakePorts();

      await runReview(depsWith(ports), candidateId);

      expect(ports.spy.emails).toHaveLength(0);
      expect(await db.select().from(notifications)).toHaveLength(0);
    });

    /** A backfill sweeps everything already listed; mailing it one at a time trains you to ignore it. */
    it('sends nothing for a backfill candidate', async () => {
      const { candidateId } = await seed({ origin: 'backfill' });
      const ports = fakePorts();

      await runReview(depsWith(ports), candidateId);

      expect(ports.spy.emails).toHaveLength(0);
    });

    /**
     * The row is claimed before the email is sent, so a job that retried after sending cannot send
     * again. Here the claim is made by hand first, standing in for the earlier attempt.
     */
    it('will not send twice for the same candidate', async () => {
      const { candidateId } = await seed();
      await db.insert(notifications).values({ candidateId, channel: 'realtime' });

      const ports = fakePorts();
      await runReview(depsWith(ports), candidateId);

      expect(ports.spy.emails).toHaveLength(0);
      expect(await db.select().from(notifications)).toHaveLength(1);
    });

    /** A review that worked is not turned into a failed candidate because the mail server was down. */
    it('stores the verdict even when the email cannot be sent', async () => {
      const { candidateId } = await seed();
      const ports = fakePorts();
      ports.sendEmail = async () => {
        throw new Error('smtp is down');
      };

      const outcome = await runReview(depsWith(ports), candidateId);

      expect(outcome).toMatchObject({ status: 'reviewed', decision: 'match', notified: false });
      const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
      expect(candidate?.stage).toBe('reviewed');

      // The durable record of "claimed but never delivered".
      const [row] = await db.select().from(notifications);
      expect(row?.sentAt).toBeNull();
    });
  });

  it('skips a candidate that has gone', async () => {
    const outcome = await runReview(depsWith(fakePorts()), crypto.randomUUID());

    expect(outcome).toEqual({ status: 'skipped', why: 'missing' });
  });

  /**
   * P1-14's stats. The poll writes `candidates_found`; everything after it can only be known once
   * the pipeline has run, so without these the item page can say a query found four hundred
   * listings and nothing about whether any of them were worth looking at.
   */
  describe('the per-plan stats the item page reads', () => {
    it('counts a reviewed candidate against its plan and charges it the pre-filter', async () => {
      const { candidateId } = await seed({ searchPlanId: 'plan-stats-match' });

      await runReview(depsWith(fakePorts()), candidateId);

      const row = await planRow('plan-stats-match');
      expect(row?.candidatesReviewed).toBe(1);
      expect(row?.candidatesMatched).toBe(1);
      expect(row?.candidatesUncertain).toBe(0);
      expect(Number(row?.prefilterCostUsd)).toBeCloseTo(0.000_02, 6);
    });

    it('records an uncertain as uncertain and not as a match', async () => {
      const { candidateId } = await seed({ searchPlanId: 'plan-stats-uncertain' });
      const ports = fakePorts({
        reviewResult: {
          criteriaResults: [
            { criterionId: 'big-box', result: 'unknown', evidence: 'the box is not pictured' },
          ],
        },
      });

      await runReview(depsWith(ports), candidateId);

      const row = await planRow('plan-stats-uncertain');
      expect(row?.candidatesReviewed).toBe(1);
      expect(row?.candidatesMatched).toBe(0);
      expect(row?.candidatesUncertain).toBe(1);
    });

    /**
     * "Reviewed" is §4's "reached vision review". A candidate the pre-filter discarded also ends
     * with a verdict, and counting it here would bury the number that matters — how many of this
     * query's listings were expensive enough to look at.
     */
    it('does not count a candidate the pre-filter discarded, but still charges the call', async () => {
      const { candidateId } = await seed({ searchPlanId: 'plan-stats-discarded' });

      await runReview(depsWith(fakePorts({ plausible: false })), candidateId);

      const row = await planRow('plan-stats-discarded');
      expect(row?.candidatesReviewed).toBe(0);
      expect(Number(row?.prefilterCostUsd)).toBeCloseTo(0.000_02, 6);
    });

    /** A hard filter calls no model at all, so there is nothing to charge the query for. */
    it('charges nothing for a candidate stopped by a hard filter', async () => {
      const { candidateId } = await seed({
        searchPlanId: 'plan-stats-filtered',
        priceCeiling: { amount: 10, currency: 'GBP' },
      });

      await runReview(depsWith(fakePorts()), candidateId);

      const row = await planRow('plan-stats-filtered');
      expect(row?.candidatesReviewed).toBe(0);
      expect(Number(row?.prefilterCostUsd)).toBe(0);
    });

    it('leaves the counters alone for a candidate that came from no plan', async () => {
      const { candidateId } = await seed({ origin: 'backfill' });

      const outcome = await runReview(depsWith(fakePorts()), candidateId);

      expect(outcome).toMatchObject({ status: 'reviewed' });
      expect(await db.select().from(searchPlanState)).toEqual([]);
    });
  });
});
