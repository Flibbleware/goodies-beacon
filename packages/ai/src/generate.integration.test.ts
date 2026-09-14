import {
  costLedger,
  createDb,
  createPool,
  createSilentLogger,
  type Database,
  runMigrations,
  settings as settingsTable,
  writeSettings,
} from '@goodies-beacon/core';
import { MockLanguageModelV3 } from 'ai/test';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateForRole } from './generate.js';
import * as providers from './providers.js';

/**
 * That a caller names a *role* and never a provider — which is what makes swapping the reviewer
 * between two providers a Settings change (the first done-when) and what P1-17's eval suite
 * relies on to run the same prompts against both.
 *
 * The model is a stub: the point under test is the plumbing around the call, and asserting it
 * against a live provider would cost money and fail when someone else's API had a bad minute.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET_KEY = 'Z29vZGllcy1iZWFjb24tdGVzdC1rZXktMzJieXRlcyE=';
const logger = createSilentLogger();

let pool: Pool | undefined;
let db: Database;

const schema = z.object({ plausible: z.boolean(), reason: z.string() });

afterAll(async () => {
  await pool?.end();
  vi.restoreAllMocks();
});

/** A model that answers with a fixed object and reports the usage a real one would. */
function stubModel(usage?: Partial<{ input: number; output: number; cacheRead: number }>) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: '{"plausible":true,"reason":"big box"}' }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: {
          total: (usage?.input ?? 1_000) + (usage?.cacheRead ?? 0),
          noCache: usage?.input ?? 1_000,
          cacheRead: usage?.cacheRead ?? 0,
          cacheWrite: 0,
        },
        outputTokens: { total: usage?.output ?? 50, text: usage?.output ?? 50, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

/** Intercepts the provider factory so the role resolution is real and only the network is not. */
function useStubModel(model = stubModel()) {
  return vi.spyOn(providers, 'createModel').mockImplementation((ref) => {
    const parsed = ref.split(':');
    return {
      provider: parsed[0] as never,
      model: parsed.slice(1).join(':'),
      languageModel: model,
    };
  });
}

describe.skipIf(!databaseUrl)('generateForRole against a real Postgres', () => {
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

  it('returns the parsed object and records what the call cost', async () => {
    useStubModel();

    const result = await generateForRole(
      { db, logger, secretKey: SECRET_KEY },
      {
        role: 'prefilter',
        schema,
        system: 'Judge plausibility.',
        prompt: 'Carmageddon big box',
      },
    );

    expect(result.object).toEqual({ plausible: true, reason: 'big box' });

    const [row] = await db.select().from(costLedger);
    expect(row).toMatchObject({ role: 'prefilter', inputTokens: 1_000, outputTokens: 50 });
    expect(Number(row?.costUsd)).toBeGreaterThan(0);
  });

  /**
   * The first done-when: nothing but a settings row decides which provider answers. The caller
   * below is byte-identical across the two runs.
   */
  it('sends the same request to a different provider after a Settings change alone', async () => {
    const spy = useStubModel();
    const call = () =>
      generateForRole(
        { db, logger, secretKey: SECRET_KEY },
        { role: 'reviewer', schema, system: 'Judge it.', prompt: 'a listing' },
      );

    await writeSettings(db, { ai: { roles: { reviewer: 'openai:gpt-5-mini' } } }, SECRET_KEY);
    const first = await call();

    await writeSettings(
      db,
      { ai: { roles: { reviewer: 'anthropic:claude-haiku-4-5' } } },
      SECRET_KEY,
    );
    const second = await call();

    expect(first.role).toMatchObject({ provider: 'openai', model: 'gpt-5-mini' });
    expect(second.role).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(spy.mock.calls.map(([ref]) => ref)).toEqual([
      'openai:gpt-5-mini',
      'anthropic:claude-haiku-4-5',
    ]);

    // Both are priced, and the ledger names which model earned each row.
    const rows = await db.select().from(costLedger);
    expect(rows.map((row) => row.model).sort()).toEqual(['claude-haiku-4-5', 'gpt-5-mini']);
    expect(rows.every((row) => row.costKnown)).toBe(true);
  });

  it('records cached input apart from fresh input, so a cached call is cheaper', async () => {
    useStubModel(stubModel({ input: 200, output: 50, cacheRead: 5_000 }));

    await generateForRole(
      { db, logger, secretKey: SECRET_KEY },
      { role: 'reviewer', schema, system: 'Judge it.', prompt: 'a listing' },
    );

    const [row] = await db.select().from(costLedger);
    expect(row?.inputTokens).toBe(200);
    expect(row?.cacheReadTokens).toBe(5_000);
  });

  it('stores the prompt as text, naming images rather than embedding them', async () => {
    useStubModel();

    const result = await generateForRole(
      { db, logger, secretKey: SECRET_KEY },
      {
        role: 'reviewer',
        schema,
        system: 'Judge it.',
        prompt: [
          { type: 'text', text: 'Big box, front' },
          { type: 'file', data: 'data:image/jpeg;base64,QUJD', mediaType: 'image' },
        ],
      },
    );

    expect(result.promptText).toContain('Judge it.');
    expect(result.promptText).toContain('Big box, front');
    expect(result.promptText).toContain('[image]');
    expect(result.promptText).not.toContain('base64');
  });
});
