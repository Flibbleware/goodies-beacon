import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { fxRates } from '../db/schema.js';
import type { Logger } from '../logger.js';
import { createConverter } from './convert.js';
import { latestRate, rateOn, refreshRates } from './rates.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;

/** Captures warnings, since "falls back with a warning" is the behaviour under test. */
function recordingLogger(): Logger & { warnings: { message: string; fields?: unknown }[] } {
  const warnings: { message: string; fields?: unknown }[] = [];
  const logger: Logger = {
    error() {},
    warn(message, fields) {
      warnings.push({ message, fields });
    },
    info() {},
    debug() {},
    child: () => logger,
  };
  return Object.assign(logger, { warnings });
}

const serving = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

const FRIDAY = {
  amount: 1,
  base: 'GBP',
  date: '2026-09-11',
  rates: { USD: 1.3508, EUR: 1.1653, JPY: 208.08 },
};

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!databaseUrl)('exchange rates against a real Postgres', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(fxRates);
  });

  it('stores a rate per currency for the published date', async () => {
    const logger = recordingLogger();
    const result = await refreshRates(db, logger, { fetchImpl: serving(FRIDAY) });

    expect(result).toMatchObject({ rateDate: '2026-09-11', stored: 3, missing: [] });
    await expect(rateOn(db, 'USD', '2026-09-11')).resolves.toBe(1.3508);
  });

  /** The ECB publishes once per working day, so a refresh that runs twice must change nothing. */
  it('is idempotent, so running it again on a Sunday is harmless', async () => {
    const logger = recordingLogger();
    await refreshRates(db, logger, { fetchImpl: serving(FRIDAY) });
    await refreshRates(db, logger, { fetchImpl: serving(FRIDAY) });

    expect(await db.select().from(fxRates)).toHaveLength(3);
  });

  it('keeps older dates rather than overwriting them, so a July verdict stays explainable', async () => {
    const logger = recordingLogger();
    await refreshRates(db, logger, { fetchImpl: serving({ ...FRIDAY, date: '2026-07-01' }) });
    await refreshRates(db, logger, { fetchImpl: serving(FRIDAY) });

    await expect(rateOn(db, 'USD', '2026-07-01')).resolves.toBe(1.3508);
    await expect(latestRate(db, 'USD')).resolves.toMatchObject({ rateDate: '2026-09-11' });
  });

  it('replaces a rate if the service corrects one for a date already stored', async () => {
    const logger = recordingLogger();
    await refreshRates(db, logger, { fetchImpl: serving(FRIDAY) });
    await refreshRates(db, logger, {
      fetchImpl: serving({ ...FRIDAY, rates: { ...FRIDAY.rates, USD: 1.4 } }),
    });

    await expect(rateOn(db, 'USD', '2026-09-11')).resolves.toBe(1.4);
  });

  it('warns when a currency we convert is missing from the answer', async () => {
    const logger = recordingLogger();
    await refreshRates(db, logger, { fetchImpl: serving({ ...FRIDAY, rates: { USD: 1.35 } }) });

    expect(logger.warnings[0]?.message).toMatch(/no rate for a currency/);
    expect(logger.warnings[0]?.fields).toMatchObject({ missing: ['EUR', 'JPY'] });
  });
});

describe.skipIf(!databaseUrl)('toGbp', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool ??= createPool(databaseUrl as string);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(fxRates);
    await refreshRates(db, recordingLogger(), { fetchImpl: serving(FRIDAY) });
  });

  const on = (date: string) => () => new Date(`${date}T12:00:00Z`);

  it('converts and reports the rate date it used', async () => {
    const converter = createConverter(db, recordingLogger(), on('2026-09-14'));

    await expect(converter.toGbp(40, 'USD')).resolves.toEqual({
      amountGbp: 29.61,
      rateDate: '2026-09-11',
    });
  });

  it('passes GBP through untouched, with no rate date', async () => {
    const converter = createConverter(db, recordingLogger(), on('2026-09-14'));

    await expect(converter.toGbp(24.99, 'GBP')).resolves.toEqual({
      amountGbp: 24.99,
      rateDate: null,
    });
  });

  it('accepts a lower-case currency code, which some sources send', async () => {
    const converter = createConverter(db, recordingLogger(), on('2026-09-14'));

    await expect(converter.toGbp(40, 'usd')).resolves.toMatchObject({ amountGbp: 29.61 });
  });

  /**
   * The done-when: a missing rate falls back to the last known one with a warning. Here the
   * service has been down for a fortnight and Friday's rate is all there is — a price converted
   * at a stale rate is far more useful than no price at all.
   */
  it('falls back to the last known rate when it is old, and warns once', async () => {
    const logger = recordingLogger();
    const converter = createConverter(db, logger, on('2026-09-25'));

    await expect(converter.toGbp(40, 'USD')).resolves.toMatchObject({ rateDate: '2026-09-11' });
    await converter.toGbp(50, 'USD');
    await converter.toGbp(60, 'USD');

    const stale = logger.warnings.filter((w) => w.message.includes('not been refreshed'));
    expect(stale).toHaveLength(1);
    expect(stale[0]?.fields).toMatchObject({ currency: 'USD', ageInDays: 14 });
  });

  it('does not warn when the rate is merely a weekend old', async () => {
    const logger = recordingLogger();
    const converter = createConverter(db, logger, on('2026-09-14'));

    await converter.toGbp(40, 'USD');

    expect(logger.warnings).toEqual([]);
  });

  it('returns null for a currency it has never had a rate for, and warns once', async () => {
    const logger = recordingLogger();
    const converter = createConverter(db, logger, on('2026-09-14'));

    await expect(converter.toGbp(40, 'CHF')).resolves.toBeNull();
    await expect(converter.toGbp(50, 'CHF')).resolves.toBeNull();

    expect(logger.warnings.filter((w) => w.message.includes('no exchange rate'))).toHaveLength(1);
  });

  it('refuses a nonsensical amount rather than storing a nonsensical price', async () => {
    const converter = createConverter(db, recordingLogger(), on('2026-09-14'));

    await expect(converter.toGbp(Number.NaN, 'USD')).resolves.toBeNull();
    await expect(converter.toGbp(-5, 'USD')).resolves.toBeNull();
  });

  it('queries once for a currency however many listings are converted', async () => {
    const converter = createConverter(db, recordingLogger(), on('2026-09-14'));
    const spy = vi.spyOn(db, 'select');

    for (let i = 0; i < 20; i += 1) await converter.toGbp(10 + i, 'USD');

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('picks up a new rate once the refresh job invalidates the cache', async () => {
    const converter = createConverter(db, recordingLogger(), on('2026-09-14'));
    await converter.toGbp(40, 'USD');

    await refreshRates(db, recordingLogger(), {
      fetchImpl: serving({ ...FRIDAY, date: '2026-09-14', rates: { USD: 2 } }),
    });
    converter.invalidate();

    await expect(converter.toGbp(40, 'USD')).resolves.toEqual({
      amountGbp: 20,
      rateDate: '2026-09-14',
    });
  });
});
