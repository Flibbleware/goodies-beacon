import { describe, expect, it } from 'vitest';
import { convert, daysBetween, fetchEcbRates, RatesUnavailableError } from './rates.js';

const serving = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

const GOOD = {
  amount: 1,
  base: 'GBP',
  date: '2026-09-11',
  rates: { USD: 1.3508, EUR: 1.1653, JPY: 208.08 },
};

describe('convert', () => {
  it('divides by the units-per-GBP rate', () => {
    // 40 USD at 1.3508 USD per GBP.
    expect(convert(40, 1.3508)).toBe(29.61);
  });

  it('handles a rate far from 1, as the yen is', () => {
    expect(convert(15_000, 208.08)).toBe(72.09);
  });

  it('rounds to whole pence, because a price ceiling compares against money', () => {
    expect(convert(10, 3)).toBe(3.33);
    expect(convert(20, 3)).toBe(6.67);
  });

  it('converts zero to zero rather than to a rounding artefact', () => {
    expect(convert(0, 1.3508)).toBe(0);
  });
});

describe('daysBetween', () => {
  it('counts days between two ISO dates', () => {
    expect(daysBetween('2026-09-11', '2026-09-14')).toBe(3);
    expect(daysBetween('2026-09-11', '2026-09-11')).toBe(0);
  });

  it('counts across a month boundary', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3);
  });

  it('treats an unparseable date as infinitely stale rather than as fresh', () => {
    expect(daysBetween('not-a-date', '2026-09-14')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('fetchEcbRates', () => {
  it('reads the published date and rates', async () => {
    const result = await fetchEcbRates({ fetchImpl: serving(GOOD) });

    expect(result.date).toBe('2026-09-11');
    expect(result.rates.USD).toBe(1.3508);
  });

  /** The ECB publishes on working days, so "latest" on a Monday is Friday's. */
  it('keeps the service’s own date rather than assuming today', async () => {
    const result = await fetchEcbRates({ fetchImpl: serving({ ...GOOD, date: '2026-09-11' }) });

    expect(result.date).toBe('2026-09-11');
  });

  it('asks for rates based on GBP', async () => {
    let asked = '';
    const impl = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(GOOD));
    }) as unknown as typeof fetch;

    await fetchEcbRates({ fetchImpl: impl });

    expect(new URL(asked).searchParams.get('base')).toBe('GBP');
  });

  it('refuses an answer in another base, which would invert every conversion', async () => {
    const impl = serving({ ...GOOD, base: 'EUR' });

    await expect(fetchEcbRates({ fetchImpl: impl })).rejects.toThrow(/answered in EUR/);
  });

  /** A zero or negative rate would not throw on division, it would produce a wrong price. */
  it('drops a rate that is zero, negative or not a number', async () => {
    const impl = serving({
      ...GOOD,
      rates: { USD: 1.35, EUR: 0, JPY: -3, CHF: 'nonsense', SEK: Number.NaN },
    });

    const result = await fetchEcbRates({ fetchImpl: impl });

    expect(Object.keys(result.rates)).toEqual(['USD']);
  });

  it('reports an HTTP failure rather than caching nothing silently', async () => {
    await expect(fetchEcbRates({ fetchImpl: serving({}, 503) })).rejects.toBeInstanceOf(
      RatesUnavailableError,
    );
  });

  it('refuses a payload it cannot read', async () => {
    const impl = (async () => new Response('not json')) as unknown as typeof fetch;

    await expect(fetchEcbRates({ fetchImpl: impl })).rejects.toThrow(/unreadable/);
  });

  it('refuses a payload with no date', async () => {
    await expect(
      fetchEcbRates({ fetchImpl: serving({ base: 'GBP', rates: { USD: 1.35 } }) }),
    ).rejects.toThrow(/unreadable/);
  });
});
