import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { fxRates } from '../db/schema.js';
import type { Logger } from '../logger.js';

/**
 * Converting a listing's price to GBP (§4, P1-06).
 *
 * Everything is compared in GBP — the price ceiling is a hard filter in §7 step 2 — so a price in
 * USD, EUR or JPY has to be converted before it can be judged. Rates come from the ECB via
 * frankfurter.dev, are cached in the database, and the date of the rate actually used is recorded
 * on the listing so an old verdict stays explainable.
 */

export const BASE_CURRENCY = 'GBP';
export const RATES_URL = 'https://api.frankfurter.dev/v1/latest';

/**
 * Fetched on every refresh. Not an exhaustive list — a rate is stored for whatever the API
 * returns — but these are the ones §1 names, so a missing one is worth noticing.
 */
export const REQUIRED_CURRENCIES = ['USD', 'EUR', 'JPY'] as const;

/** How stale a rate may be before conversion warns. The ECB does not publish at weekends. */
export const STALE_AFTER_DAYS = 4;

export interface EcbResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

export class RatesUnavailableError extends Error {
  override readonly name = 'RatesUnavailableError';
}

export interface FetchRatesOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  signal?: AbortSignal;
}

/** One call to the rate service, validated enough that a bad payload cannot poison the cache. */
export async function fetchEcbRates(options: FetchRatesOptions = {}): Promise<EcbResponse> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = new URL(options.url ?? RATES_URL);
  url.searchParams.set('base', BASE_CURRENCY);

  const response = await doFetch(url.toString(), {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new RatesUnavailableError(`rate service returned HTTP ${response.status}`);
  }

  const body = (await response.json().catch(() => null)) as Partial<EcbResponse> | null;
  if (!body || typeof body.date !== 'string' || typeof body.rates !== 'object' || !body.rates) {
    throw new RatesUnavailableError('rate service returned an unreadable payload');
  }
  if (body.base !== BASE_CURRENCY) {
    throw new RatesUnavailableError(`rate service answered in ${body.base}, not ${BASE_CURRENCY}`);
  }

  const rates: Record<string, number> = {};
  for (const [currency, rate] of Object.entries(body.rates)) {
    // A zero or negative rate would divide wrongly rather than fail, so it is dropped here.
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      rates[currency.toUpperCase()] = rate;
    }
  }

  return { base: body.base, date: body.date, rates };
}

export interface RefreshResult {
  rateDate: string;
  stored: number;
  missing: string[];
}

/**
 * Fetches and caches the day's rates. Idempotent: the ECB publishes once per working day, so a
 * refresh that runs three times on a Sunday writes the Friday row three times and changes nothing.
 */
export async function refreshRates(
  db: Database,
  logger: Logger,
  options: FetchRatesOptions = {},
): Promise<RefreshResult> {
  const { date, rates } = await fetchEcbRates(options);
  const entries = Object.entries(rates);

  if (entries.length > 0) {
    await db
      .insert(fxRates)
      .values(
        entries.map(([currency, rate]) => ({
          currency,
          rateDate: date,
          unitsPerGbp: String(rate),
        })),
      )
      .onConflictDoUpdate({
        target: [fxRates.currency, fxRates.rateDate],
        // `excluded` is the row the insert tried to write. Updating rather than doing nothing so
        // that a corrected rate replaces the one already stored for that date.
        set: { unitsPerGbp: sql`excluded."units_per_gbp"`, fetchedAt: new Date() },
      });
  }

  const missing = REQUIRED_CURRENCIES.filter((currency) => !(currency in rates));
  if (missing.length > 0) {
    logger.warn('rate refresh returned no rate for a currency we convert', { date, missing });
  }

  logger.info('exchange rates refreshed', { rateDate: date, stored: entries.length });
  return { rateDate: date, stored: entries.length, missing };
}

/** The newest stored rate for a currency, or undefined if there has never been one. */
export async function latestRate(
  db: Database,
  currency: string,
): Promise<{ unitsPerGbp: number; rateDate: string } | undefined> {
  const [row] = await db
    .select({ unitsPerGbp: fxRates.unitsPerGbp, rateDate: fxRates.rateDate })
    .from(fxRates)
    .where(eq(fxRates.currency, currency.toUpperCase()))
    .orderBy(desc(fxRates.rateDate))
    .limit(1);

  if (!row) return undefined;
  const value = Number(row.unitsPerGbp);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return { unitsPerGbp: value, rateDate: row.rateDate };
}

export async function rateOn(
  db: Database,
  currency: string,
  rateDate: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ unitsPerGbp: fxRates.unitsPerGbp })
    .from(fxRates)
    .where(and(eq(fxRates.currency, currency.toUpperCase()), eq(fxRates.rateDate, rateDate)))
    .limit(1);

  const value = row ? Number(row.unitsPerGbp) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Rounded to whole pence: a price is money, and a price ceiling compares against money. */
export function convert(amount: number, unitsPerGbp: number): number {
  return Math.round((amount / unitsPerGbp) * 100) / 100;
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / 86_400_000);
}
