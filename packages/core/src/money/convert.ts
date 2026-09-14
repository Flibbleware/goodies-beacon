import type { Database } from '../db/client.js';
import type { Logger } from '../logger.js';
import { BASE_CURRENCY, convert, daysBetween, latestRate, STALE_AFTER_DAYS } from './rates.js';

/**
 * `toGbp(amount, currency)` (P1-06), with the rate date it used.
 *
 * A missing rate is not an error that stops a poll: a listing whose price cannot be converted is
 * still worth showing, it just cannot be compared against the ceiling. So the result says which
 * happened rather than throwing, and §7's hard filter treats a null `priceGbp` as "price unknown"
 * rather than "free".
 */

export interface Converted {
  amountGbp: number;
  /** The ECB publication date of the rate used, or null when no conversion was needed. */
  rateDate: string | null;
}

export interface Converter {
  toGbp(amount: number, currency: string): Promise<Converted | null>;
  /** Drops the in-process cache; the refresh job calls it so a new rate is picked up at once. */
  invalidate(): void;
}

/**
 * Caches each currency's newest rate in memory for the life of a poll.
 *
 * A poll converts hundreds of listings and they all want the same handful of rates, so without
 * this every listing costs a query. The cache is dropped when the refresh job writes new rates,
 * and has a short time limit besides, so a long-running worker cannot hold a stale rate all day.
 */
export const CACHE_TTL_MS = 60 * 60 * 1000;

export function createConverter(
  db: Database,
  logger: Logger,
  now: () => Date = () => new Date(),
): Converter {
  const cache = new Map<string, { unitsPerGbp: number; rateDate: string; cachedAt: number }>();
  /** Warned once per currency per process, so a poll of 500 listings logs one line, not 500. */
  const warned = new Set<string>();

  return {
    async toGbp(amount, currency) {
      if (!Number.isFinite(amount) || amount < 0) return null;

      const code = currency.toUpperCase();
      if (code === BASE_CURRENCY)
        return { amountGbp: Math.round(amount * 100) / 100, rateDate: null };

      const at = now();
      const cached = cache.get(code);
      const rate =
        cached && at.getTime() - cached.cachedAt < CACHE_TTL_MS
          ? cached
          : await latestRate(db, code);

      if (!rate) {
        if (!warned.has(code)) {
          warned.add(code);
          logger.warn('no exchange rate stored, leaving the price unconverted', { currency: code });
        }
        return null;
      }

      if (!('cachedAt' in rate)) {
        cache.set(code, { ...rate, cachedAt: at.getTime() });
      }

      /**
       * The fallback the done-when asks for: the newest rate is used even when it is old, because
       * a price converted at Friday's rate is far more useful than no price at all. It warns once
       * so a rate service that has been down for a week is visible without being noisy.
       */
      const age = daysBetween(rate.rateDate, at.toISOString().slice(0, 10));
      if (age > STALE_AFTER_DAYS && !warned.has(`stale:${code}`)) {
        warned.add(`stale:${code}`);
        logger.warn('using an exchange rate that has not been refreshed recently', {
          currency: code,
          rateDate: rate.rateDate,
          ageInDays: age,
        });
      }

      return { amountGbp: convert(amount, rate.unitsPerGbp), rateDate: rate.rateDate };
    },

    invalidate() {
      cache.clear();
      warned.clear();
    },
  };
}
