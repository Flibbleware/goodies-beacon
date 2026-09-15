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
import { DESCRIPTION_LIMIT, runPrefilter, TITLE_LIMIT } from './prefilter.js';
import * as providers from './providers.js';

/**
 * What the pre-filter does around the model call: the ledger row, the bounded input, and above
 * all what happens when the model does not answer.
 *
 * The model is a stub. Whether the *prompt* makes good judgements is measured against a real one
 * by `scripts/prefilter-check.ts` and, in CI, by P1-17's eval suite — a test that spent money and
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

function recordingLogger(): Logger & { warnings: { message: string }[] } {
  const warnings: { message: string }[] = [];
  const logger = {
    warnings,
    debug() {},
    info() {},
    warn(message: string) {
      warnings.push({ message });
    },
    error() {},
    child() {
      return logger;
    },
  };
  return logger as unknown as Logger & { warnings: { message: string }[] };
}

/** Answers with a fixed verdict, and records the prompt it was handed. */
function stub(answer: unknown, sent: { prompt?: string } = {}) {
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      sent.prompt = JSON.stringify(options.prompt);
      return {
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 800, noCache: 800, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 30, text: 30, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

  vi.spyOn(providers, 'createModel').mockReturnValue({
    provider: 'openai',
    model: 'gpt-5-nano',
    languageModel: model,
  });

  return sent;
}

/** A model that cannot be reached at all. */
function stubFailure(error: Error) {
  vi.spyOn(providers, 'createModel').mockReturnValue({
    provider: 'openai',
    model: 'gpt-5-nano',
    languageModel: new MockLanguageModelV3({
      doGenerate: async () => {
        throw error;
      },
    }),
  });
}

const listing = { title: 'Carmageddon PC CD-ROM big box', description: 'Complete with manual.' };

describe.skipIf(!databaseUrl)('the pre-filter against a real Postgres', () => {
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

  it('keeps a plausible listing and records what the call cost', async () => {
    const logger = recordingLogger();
    stub({ plausible: true, reason: 'A boxed copy of the right game.' });

    const result = await runPrefilter({ db, logger, secretKey: SECRET_KEY }, { listing, spec });

    expect(result.plausible).toBe(true);
    expect(result.reason).toBe('A boxed copy of the right game.');
    expect(result.failedOpen).toBe(false);
    expect(result.promptVersion).toBe('prefilter.v1');

    const [row] = await db.select().from(costLedger);
    expect(row).toMatchObject({ role: 'prefilter', model: 'gpt-5-nano' });
    expect(Number(row?.costUsd)).toBeGreaterThan(0);
  });

  it('discards an obvious miss', async () => {
    stub({ plausible: false, reason: 'This is a t-shirt, not the game.' });

    const result = await runPrefilter(
      { db, logger: recordingLogger(), secretKey: SECRET_KEY },
      { listing: { title: 'Carmageddon T-Shirt Size L' }, spec },
    );

    expect(result.plausible).toBe(false);
    expect(result.reason).toContain('t-shirt');
  });

  it('charges the call to the item and the candidate, for the costs page', async () => {
    stub({ plausible: true, reason: 'ok' });

    await runPrefilter(
      { db, logger: recordingLogger(), secretKey: SECRET_KEY },
      { listing, spec, wantedItemId: null, candidateId: null },
    );

    const [row] = await db.select().from(costLedger);
    expect(row?.role).toBe('prefilter');
  });

  /**
   * The asymmetry this stage is built around: a wrongly kept listing costs a fraction of a penny
   * and the reviewer catches it; a wrongly discarded one is never reviewed, never emailed and
   * never noticed. So an unreachable model keeps the listing.
   */
  it('keeps the listing when the model cannot be reached, and says so', async () => {
    const logger = recordingLogger();
    stubFailure(new Error('connect ECONNREFUSED'));

    const result = await runPrefilter({ db, logger, secretKey: SECRET_KEY }, { listing, spec });

    expect(result.plausible).toBe(true);
    expect(result.failedOpen).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(logger.warnings[0]?.message).toContain('keeping the listing for review');
  });

  it('keeps the listing when the model answers something that will not parse', async () => {
    const logger = recordingLogger();
    stub({ plausible: 'maybe', reason: 42 });

    const result = await runPrefilter({ db, logger, secretKey: SECRET_KEY }, { listing, spec });

    expect(result.plausible).toBe(true);
    expect(result.failedOpen).toBe(true);
  });

  /** Shutting down is not a pre-filter outcome; it must stop the job rather than pass it. */
  it('lets an abort through rather than treating it as a kept listing', async () => {
    const controller = new AbortController();
    controller.abort();
    stubFailure(new Error('aborted'));

    await expect(
      runPrefilter(
        { db, logger: recordingLogger(), secretKey: SECRET_KEY },
        { listing, spec, abortSignal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it('sends the bounded input rather than whatever the marketplace wrote', async () => {
    const sent = stub({ plausible: true, reason: 'ok' });

    await runPrefilter(
      { db, logger: recordingLogger(), secretKey: SECRET_KEY },
      {
        listing: {
          title: 'K'.repeat(400),
          description: `${'word '.repeat(2_000)}TRAILING_MARKER`,
        },
        spec,
      },
    );

    const prompt = sent.prompt ?? '';
    expect(prompt).not.toContain('TRAILING_MARKER');
    expect(prompt).not.toContain('K'.repeat(TITLE_LIMIT + 1));
    // Still generous: the budget is spent, not merely respected.
    expect(prompt.length).toBeGreaterThan(DESCRIPTION_LIMIT);
  });

  it('sends the plausibility note, because that is what the note is for', async () => {
    const sent = stub({ plausible: true, reason: 'ok' });

    await runPrefilter({ db, logger: recordingLogger(), secretKey: SECRET_KEY }, { listing, spec });

    expect(sent.prompt).toContain('Sellers title these inconsistently');
  });
});
