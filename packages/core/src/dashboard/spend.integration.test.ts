import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { costLedger, fxRates } from '../db/schema.js';
import type { AiRole } from '../domain/constants.js';
import { spendBreakdown } from './spend.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;

afterAll(async () => {
  await pool?.end();
});

/**
 * Mid-afternoon in London on 16 June, when the clocks say UTC+1: "today" starts at 23:00 UTC the
 * day before, the last seven days reach back into May, and the month starts at midnight UTC.
 */
const NOW = new Date('2026-06-16T14:00:00Z');
const breakdown = () => spendBreakdown(db, { timezone: 'Europe/London', now: NOW });

async function spend(
  role: AiRole,
  costUsd: number,
  createdAt: Date,
  costKnown = true,
): Promise<void> {
  await db.insert(costLedger).values({
    role,
    provider: role === 'prefilter' ? 'google' : 'openai',
    model: role === 'prefilter' ? 'gemini-3.5-flash-lite' : 'gpt-5-mini',
    costUsd: costUsd.toFixed(6),
    costKnown,
    createdAt,
  });
}

describe.skipIf(!databaseUrl)('the spend breakdown against a real Postgres', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(costLedger);
    await db.delete(fxRates);
  });

  it('is empty when nothing has been spent', async () => {
    expect(await breakdown()).toEqual({ roles: [], usdPerGbp: null });
  });

  it('splits by role, in pipeline order, over each period', async () => {
    await spend('reviewer', 0.01, new Date('2026-06-16T10:00:00Z'));
    await spend('prefilter', 0.0001, new Date('2026-06-16T10:00:00Z'));
    await spend('prefilter', 0.0002, new Date('2026-06-12T10:00:00Z'));
    await spend('reviewer', 0.02, new Date('2026-06-02T10:00:00Z'));

    const { roles } = await breakdown();

    expect(roles.map((row) => row.role)).toEqual(['prefilter', 'reviewer']);
    expect(roles[0]).toMatchObject({
      today: { calls: 1, known: true },
      week: { calls: 2 },
      month: { calls: 2 },
    });
    expect(roles[0]?.week.usd).toBeCloseTo(0.0003, 6);
    expect(roles[1]).toMatchObject({
      today: { calls: 1, usd: 0.01 },
      week: { calls: 1, usd: 0.01 },
      month: { calls: 2, usd: 0.03 },
    });
  });

  /** A call at 23:30 UTC on the 15th is 00:30 on the 16th in London, so it is today's. */
  it("reads today from the instance's midnight rather than UTC's", async () => {
    await spend('reviewer', 0.01, new Date('2026-06-15T23:30:00Z'));
    await spend('reviewer', 0.01, new Date('2026-06-15T22:30:00Z'));

    const [reviewer] = (await breakdown()).roles;

    expect(reviewer?.today.calls).toBe(1);
    expect(reviewer?.week.calls).toBe(2);
  });

  /**
   * The month is the budget cap's, so it starts at midnight UTC on the 1st while the seven days
   * reach back past it — a role with calls only in May still has a row, with an empty month.
   */
  it('takes the last seven days across a month boundary, and keeps the month to the cap’s', async () => {
    const early = new Date('2026-06-03T12:00:00Z');
    await spend('reviewer', 0.01, new Date('2026-05-31T12:00:00Z'));

    const [reviewer] = (await spendBreakdown(db, { timezone: 'Europe/London', now: early })).roles;

    expect(reviewer).toMatchObject({
      today: { calls: 0, usd: 0 },
      week: { calls: 1, usd: 0.01 },
      month: { calls: 0, usd: 0 },
    });
  });

  it('leaves out calls older than every period', async () => {
    await spend('reviewer', 1, new Date('2026-05-01T12:00:00Z'));

    expect((await breakdown()).roles).toEqual([]);
  });

  it('marks a period that includes an unpriced call, and only that period', async () => {
    await spend('reviewer', 0.01, new Date('2026-06-16T10:00:00Z'));
    await spend('reviewer', 0, new Date('2026-06-02T10:00:00Z'), false);

    const [reviewer] = (await breakdown()).roles;

    expect(reviewer?.today.known).toBe(true);
    expect(reviewer?.week.known).toBe(true);
    expect(reviewer?.month.known).toBe(false);
  });

  it('carries the newest dollar rate for the page to convert with', async () => {
    await db.insert(fxRates).values([
      { currency: 'USD', rateDate: '2026-06-10', unitsPerGbp: '1.20000000' },
      { currency: 'USD', rateDate: '2026-06-15', unitsPerGbp: '1.25000000' },
    ]);

    expect((await breakdown()).usdPerGbp).toBe(1.25);
  });
});
