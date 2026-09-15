import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  costLedger,
  createDb,
  createPool,
  type Database,
  type Logger,
  runMigrations,
  settings as settingsTable,
  wantedSpecSchema,
} from '@goodies-beacon/core';
import { MockLanguageModelV3 } from 'ai/test';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteImageError } from './images.js';
import * as providers from './providers.js';
import { ReviewFailedError, type ReviewImage, runReviewer } from './reviewer.js';

/**
 * What the reviewer does around the model call: the ledger row, the prompt it records, the order
 * it sends things in, and above all what happens when the model will not answer properly.
 *
 * The model is a stub. Whether the *prompt* makes good judgements is measured against a real one
 * by `scripts/reviewer-check.ts` and, in CI, by P1-17's eval suite — a test that spent money and
 * failed when someone else's API had a bad minute would not be a test.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET_KEY = 'Z29vZGllcy1iZWFjb24tdGVzdC1rZXktMzJieXRlcyE=';
const SPECS = fileURLToPath(new URL('../../core/src/domain/fixtures', import.meta.url));

const spec = wantedSpecSchema.parse(JSON.parse(readFileSync(`${SPECS}/carmageddon.json`, 'utf8')));

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
  vi.restoreAllMocks();
});

function recordingLogger(): Logger & { warnings: { message: string; fields: unknown }[] } {
  const warnings: { message: string; fields: unknown }[] = [];
  const logger = {
    warnings,
    debug() {},
    info() {},
    warn(message: string, fields: unknown) {
      warnings.push({ message, fields });
    },
    error() {},
    child() {
      return logger;
    },
  };
  return logger as unknown as Logger & { warnings: { message: string; fields: unknown }[] };
}

/** A full, well-formed answer to the Carmageddon spec's five criteria. */
const goodAnswer = {
  criteriaResults: spec.criteria.map((criterion) => ({
    criterionId: criterion.id,
    result: 'pass' as const,
    evidence: `settled by the photographs (${criterion.id})`,
  })),
  englishSummary: 'A complete big box copy in good condition.',
  shipsToUk: 'yes' as const,
  grade: null,
};

/** Answers with a fixed object, and records the prompt it was handed. */
function stub(answer: unknown, sent: { prompt?: string; calls?: number } = {}) {
  sent.calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      sent.calls = (sent.calls ?? 0) + 1;
      sent.prompt = JSON.stringify(options.prompt);
      return {
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 4_000, noCache: 4_000, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 200, text: 200, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

  vi.spyOn(providers, 'createModel').mockReturnValue({
    provider: 'openai',
    model: 'gpt-5-mini',
    languageModel: model,
  });

  return sent;
}

/** A model that cannot be reached at all. */
function stubFailure(error: Error) {
  vi.spyOn(providers, 'createModel').mockReturnValue({
    provider: 'openai',
    model: 'gpt-5-mini',
    languageModel: new MockLanguageModelV3({
      doGenerate: async () => {
        throw error;
      },
    }),
  });
}

const listing = {
  title: 'Carmageddon PC CD-ROM big box',
  description: 'Complete with manual and disc.',
  price: '£95.00',
  url: 'https://example.test/item/1',
};

const bytes = new Uint8Array([1, 2, 3, 4]);

function image(mediaId: string, label: string): ReviewImage {
  return { mediaId, label, image: bytes, mediaType: 'image/webp' };
}

describe.skipIf(!databaseUrl)('the reviewer against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(costLedger);
    await db.delete(settingsTable);
    vi.restoreAllMocks();
  });

  it('returns the criteria results and records what the call cost', async () => {
    const logger = recordingLogger();
    stub(goodAnswer);

    const result = await runReviewer({ db, logger, secretKey: SECRET_KEY }, { listing, spec });

    expect(result.criteriaResults).toHaveLength(spec.criteria.length);
    expect(result.englishSummary).toBe('A complete big box copy in good condition.');
    expect(result.shipsToUk).toBe('yes');
    expect(result.grade).toBeNull();
    expect(result.promptVersion).toBe('reviewer.v1');
    expect(result.costUsd).toBeGreaterThan(0);

    const [row] = await db.select().from(costLedger);
    expect(row?.role).toBe('reviewer');
    expect(row?.model).toBe('gpt-5-mini');
    expect(logger.warnings).toEqual([]);
  });

  /**
   * "The exact prompt and image list sent are stored with the verdict so Show prompt can display
   * them" — this is that, minus the storing, which is P1-12's job.
   */
  it('records the prompt it sent, with the images named rather than embedded', async () => {
    const result = await runReviewer(
      { db, logger: recordingLogger(), secretKey: SECRET_KEY },
      {
        listing: { ...listing, images: [image('m-3', 'Seller photo 1')] },
        spec,
        referenceImages: [image('m-1', 'UK big box, front'), image('m-2', 'UK big box, spine')],
        ...stubAnd(),
      },
    );

    expect(result.promptText).toContain('You are the reviewer');
    expect(result.promptText).toContain('UK big box, front');
    expect(result.promptText).toContain('Carmageddon PC CD-ROM big box');
    // Bytes would dwarf every other row in the database and the nightly dump with it.
    expect(result.promptText).toContain('[image]');
    expect(result.promptText).not.toContain('base64');

    expect(result.promptImages).toEqual([
      { mediaId: 'm-1', label: 'UK big box, front', kind: 'reference' },
      { mediaId: 'm-2', label: 'UK big box, spine', kind: 'reference' },
      { mediaId: 'm-3', label: 'Seller photo 1', kind: 'listing' },
    ]);
  });

  /**
   * §9: everything identical for every candidate of an item goes first, so a provider that caches
   * prompt prefixes charges a fraction for it from the second listing onwards. Reversing these two
   * costs nothing on the first candidate and everything on the rest.
   */
  it('sends the spec, criteria and reference images before the listing', async () => {
    const sent = stub(goodAnswer);

    await runReviewer(
      { db, logger: recordingLogger(), secretKey: SECRET_KEY },
      {
        listing,
        spec,
        referenceImages: [image('m-1', 'A distinctive reference label')],
      },
    );

    const prompt = sent.prompt as string;
    const listingAt = prompt.indexOf('# The listing');

    expect(prompt.indexOf('What the collector wants')).toBeLessThan(listingAt);
    expect(prompt.indexOf('# The criteria')).toBeLessThan(listingAt);
    expect(prompt.indexOf('A distinctive reference label')).toBeLessThan(listingAt);
    expect(prompt.indexOf('Carmageddon PC CD-ROM big box')).toBeGreaterThan(listingAt);
  });

  it('tells the model how many listing photographs it is being shown', async () => {
    const sent = stub(goodAnswer);

    await runReviewer(
      { db, logger: recordingLogger(), secretKey: SECRET_KEY },
      { listing: { ...listing, images: [image('m-1', ''), image('m-2', '')] }, spec },
    );

    expect(sent.prompt).toContain('Photographs: 2');
  });

  it('says there are none when the listing has no photographs', async () => {
    const sent = stub(goodAnswer);

    await runReviewer({ db, logger: recordingLogger(), secretKey: SECRET_KEY }, { listing, spec });

    expect(sent.prompt).toContain('Photographs: none');
  });

  /**
   * A malformed response is retried once by `generateForRole` and then given up on. The reviewer
   * does *not* fail open the way the pre-filter does: a review that silently produced nothing is a
   * listing the collector is never told about, and there is no later stage to catch it.
   */
  it('fails loudly when the model will not hold the schema, after one retry', async () => {
    const logger = recordingLogger();
    const sent = stub({ criteriaResults: 'not an array', englishSummary: 12 });

    const failure = await runReviewer(
      { db, logger, secretKey: SECRET_KEY },
      { listing, spec, candidateId: null },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ReviewFailedError);
    const reviewFailure = failure as ReviewFailedError;
    expect(reviewFailure.malformedOutput).toBe(true);
    expect(sent.calls).toBe(2);

    // A failed review is as inspectable as a successful one: the first question is always what
    // we actually sent it.
    expect(reviewFailure.promptText).toContain('You are the reviewer');
    expect(reviewFailure.promptText).toContain('Carmageddon PC CD-ROM big box');
  });

  it('fails loudly when the model cannot be reached, carrying the prompt', async () => {
    stubFailure(new Error('connect ECONNREFUSED'));

    const failure = await runReviewer(
      { db, logger: recordingLogger(), secretKey: SECRET_KEY },
      { listing, spec, referenceImages: [image('m-1', 'front')] },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ReviewFailedError);
    const reviewFailure = failure as ReviewFailedError;
    expect(reviewFailure.malformedOutput).toBe(false);
    expect(reviewFailure.message).toContain('ECONNREFUSED');
    expect(reviewFailure.promptImages).toEqual([
      { mediaId: 'm-1', label: 'front', kind: 'reference' },
    ]);
  });

  /**
   * Zod proves the shape, not that the question was answered. A criterion with no answer becomes
   * unknown, which §7 step 6 surfaces or rejects on, rather than vanishing into a pass.
   */
  it('fills in a criterion the model did not answer as unknown, and says so', async () => {
    const logger = recordingLogger();
    stub({
      ...goodAnswer,
      criteriaResults: goodAnswer.criteriaResults.slice(0, 3),
    });

    const result = await runReviewer({ db, logger, secretKey: SECRET_KEY }, { listing, spec });

    expect(result.criteriaResults).toHaveLength(spec.criteria.length);
    const filled = result.criteriaResults.filter((entry) => entry.result === 'unknown');
    expect(filled).toHaveLength(2);
    expect(logger.warnings[0]?.message).toBe('the reviewer did not answer the criteria as asked');
  });

  /**
   * The SDK resolves a URL by fetching it itself, which would send a marketplace-supplied address
   * out of the worker with none of §12's protections. P1-05 exists to do that fetch under guard.
   */
  it('refuses a remote image URL rather than letting the SDK fetch it', async () => {
    stub(goodAnswer);

    await expect(
      runReviewer(
        { db, logger: recordingLogger(), secretKey: SECRET_KEY },
        {
          listing: {
            ...listing,
            images: [
              { mediaId: 'm-1', label: 'seller photo', image: 'https://example.invalid/a.jpg' },
            ],
          },
          spec,
        },
      ),
    ).rejects.toBeInstanceOf(RemoteImageError);
  });
});

/** Stubs the model and returns nothing, so a test can stub inline in its request literal. */
function stubAnd() {
  stub(goodAnswer);
  return {};
}
