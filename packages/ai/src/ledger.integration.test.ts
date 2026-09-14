import {
  costLedger,
  createDb,
  createPool,
  type Database,
  type Logger,
  runMigrations,
} from '@goodies-beacon/core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordUsage, resetUnknownModelWarnings } from './ledger.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

/** Collects what was logged, so the unknown-model warning can be asserted rather than assumed. */
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

describe.skipIf(!databaseUrl)('the cost ledger against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(costLedger);
    resetUnknownModelWarnings();
  });

  it('records the call with its cost and the tokens it used', async () => {
    const logger = recordingLogger();

    const result = await recordUsage(db, logger, {
      role: 'reviewer',
      provider: 'openai',
      model: 'gpt-5-mini',
      usage: { inputTokens: 4_000, outputTokens: 400, cacheReadTokens: 6_000 },
    });

    const [row] = await db.select().from(costLedger);
    expect(result.known).toBe(true);
    expect(row).toMatchObject({
      role: 'reviewer',
      provider: 'openai',
      model: 'gpt-5-mini',
      inputTokens: 4_000,
      outputTokens: 400,
      cacheReadTokens: 6_000,
      costKnown: true,
    });
    expect(Number(row?.costUsd)).toBeCloseTo(result.costUsd, 6);
    expect(Number(row?.costUsd)).toBeGreaterThan(0);
  });

  /** The done-when: an unknown model warns rather than recording a confident zero. */
  it('warns about a model it cannot price, and marks the row as unknown', async () => {
    const logger = recordingLogger();

    const result = await recordUsage(db, logger, {
      role: 'reviewer',
      provider: 'openai',
      model: 'gpt-9-imaginary',
      usage: { inputTokens: 100_000, outputTokens: 10_000 },
    });

    const [row] = await db.select().from(costLedger);
    expect(result).toEqual({ costUsd: 0, known: false });
    expect(row?.costKnown).toBe(false);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.message).toContain('no price');
  });

  /** A poll of 500 listings should log one line about a missing price, not 500. */
  it('warns once per model per process', async () => {
    const logger = recordingLogger();

    for (let n = 0; n < 5; n += 1) {
      await recordUsage(db, logger, {
        role: 'prefilter',
        provider: 'openai',
        model: 'gpt-9-imaginary',
        usage: { inputTokens: 10, outputTokens: 1 },
      });
    }

    expect(logger.warnings).toHaveLength(1);
    expect(await db.select().from(costLedger)).toHaveLength(5);
  });

  it('records a local model as free without warning about it', async () => {
    const logger = recordingLogger();

    const result = await recordUsage(db, logger, {
      role: 'prefilter',
      provider: 'ollama',
      model: 'llama3.1:8b',
      usage: { inputTokens: 5_000, outputTokens: 200 },
    });

    expect(result).toEqual({ costUsd: 0, known: true });
    expect(logger.warnings).toHaveLength(0);
  });

  it('attributes the call to an item and a candidate, so the costs page can group by them', async () => {
    const logger = recordingLogger();

    await recordUsage(db, logger, {
      role: 'prefilter',
      provider: 'openai',
      model: 'gpt-5-nano',
      usage: { inputTokens: 500, outputTokens: 20 },
      wantedItemId: null,
      candidateId: null,
    });

    const [row] = await db.select().from(costLedger);
    expect(row?.wantedItemId).toBeNull();
    expect(row?.candidateId).toBeNull();
  });
});
