import { fileURLToPath } from 'node:url';
import {
  createHarness,
  type FixtureRoute,
  type SearchPlan,
  sellerHash,
} from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { buildFilter, ebayAdapter } from './index.js';

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));
const SALT = 'test-instance-salt';

const CREDENTIALS = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  sellerSalt: SALT,
};

const TOKEN_ROUTE: FixtureRoute = {
  match: '/identity/v1/oauth2/token',
  body: { access_token: 'test-token', expires_in: 7200 },
};

const plan = (over: Partial<SearchPlan> = {}): SearchPlan => ({
  id: 'plan-1',
  source: 'ebay',
  query: 'carmageddon',
  region: 'EBAY_GB',
  options: {},
  enabled: true,
  watermark: null,
  ...over,
});

const harness = (routes: FixtureRoute[]) =>
  createHarness({
    adapter: ebayAdapter,
    fixturesDir: FIXTURES,
    credentials: CREDENTIALS,
    routes: [TOKEN_ROUTE, ...routes],
  });

/**
 * Serves each named fixture once, then an empty page. The recorded fixtures carry eBay's real
 * `next` link, so a route that answered every request with the same file would page forever and
 * the adapter would look broken when it is doing exactly what it should.
 */
function pages(...names: string[]): FixtureRoute {
  let index = 0;
  return {
    match: '/item_summary/search',
    get fixture(): string {
      const name = names[index] ?? 'gb-empty-result.json';
      index += 1;
      return name;
    },
  } as FixtureRoute;
}

const searching = (fixture = 'gb-baseline.json') => harness([pages(fixture)]);

/** The first search request, which is the one carrying the query and filter the plan asked for. */
const firstSearch = (requests: readonly string[]): URL =>
  new URL(requests.find((url) => url.includes('item_summary/search')) as string);

describe('search', () => {
  it('returns listings the pipeline can store', async () => {
    const listings = await searching().search(plan());

    expect(listings).toHaveLength(10);
    expect(listings[0]?.source).toBe('ebay');
    expect(listings[0]?.externalId).toMatch(/^v1\|/);
    expect(listings[0]?.url).toContain('ebay.co.uk');
  });

  it('asks for the plan’s marketplace, query and newest-first ordering', async () => {
    const test = searching();
    await test.search(plan({ region: 'EBAY_US', query: 'mac performa' }));

    const url = firstSearch(test.requests);
    expect(url.searchParams.get('q')).toBe('mac performa');
    expect(url.searchParams.get('sort')).toBe('newlyListed');
  });

  it('sends the watermark as an itemStartDate filter', async () => {
    const since = new Date('2026-09-06T00:00:00.000Z');
    const test = searching();
    await test.search(plan(), { since });

    const url = firstSearch(test.requests);
    expect(url.searchParams.get('filter')).toContain('itemStartDate:[2026-09-06T00:00:00.000Z]');
  });

  it('stops at the watermark rather than returning everything and filtering later', async () => {
    // The baseline fixture is newest-first; this watermark falls partway through it.
    const all = await searching().search(plan());
    const cutoff = all[3]?.listedAt as Date;

    const limited = await searching().search(plan(), { since: cutoff });

    expect(limited).toHaveLength(3);
    expect(limited.at(-1)?.externalId).toBe(all[2]?.externalId);
  });

  it('copes with an empty result', async () => {
    const listings = await searching('gb-empty-result.json').search(plan());

    expect(listings).toEqual([]);
  });

  it('stops paging at the cap', async () => {
    const listings = await searching('gb-broad-macintosh.json').search(plan(), { cap: 4 });

    expect(listings).toHaveLength(4);
  });

  it('follows the next link until the cap, then stops asking', async () => {
    const test = harness([pages('gb-page-1.json', 'gb-page-2.json')]);

    // Two recorded pages of two listings each; the cap of 4 is reached exactly as the second
    // page is consumed, so a third request is never made.
    const listings = await test.search(plan(), { cap: 4 });

    expect(listings).toHaveLength(4);
    expect(test.requests.filter((url) => url.includes('item_summary/search'))).toHaveLength(2);
  });

  it('ignores the watermark on a backfill, which asks what is listed right now', async () => {
    const test = searching();
    await test.search(plan(), { since: new Date('2026-09-01T00:00:00.000Z'), mode: 'backfill' });

    const url = firstSearch(test.requests);
    expect(url.searchParams.get('filter')).toBeNull();
  });
});

describe('normalising a listing', () => {
  it('captures price and currency', async () => {
    const [first] = await searching().search(plan());

    expect(first?.priceAmount).toBeGreaterThan(0);
    expect(first?.priceCurrency).toBe('GBP');
  });

  it('detects fixed price', async () => {
    const listings = await searching('gb-fixed-only.json').search(plan());

    expect(listings.every((listing) => listing.buyingType === 'fixed')).toBe(true);
  });

  it('detects an auction and takes its price from currentBidPrice', async () => {
    const listings = await searching('gb-auction-only.json').search(plan());
    const auction = listings.find((listing) => listing.buyingType === 'auction');

    expect(auction).toBeDefined();
    expect(listings.every((listing) => listing.buyingType === 'auction')).toBe(true);
    // The gotcha S1-01 found: eBay reports `price: null` on an auction. A null here would be
    // handed to the price-ceiling hard filter as if the item were free.
    expect(auction?.priceAmount).toBeGreaterThan(0);
    expect(auction?.priceCurrency).toBe('GBP');
    expect(auction?.endsAt).toBeInstanceOf(Date);
  });

  it('records the listing date, which is what advances the watermark', async () => {
    const listings = await searching().search(plan());

    expect(listings.every((listing) => listing.listedAt instanceof Date)).toBe(true);
  });

  it('records the seller location', async () => {
    const listings = await searching('gb-broad-macintosh.json').search(plan());
    const countries = new Set(listings.map((listing) => listing.itemLocationCountry));

    expect(countries.size).toBeGreaterThan(1);
    expect([...countries].every((code) => code === null || /^[A-Z]{2}$/.test(code))).toBe(true);
  });

  it('leaves ships-to-UK unknown until enrichment, since search never carries it', async () => {
    const listings = await searching().search(plan());

    expect(listings.every((listing) => listing.shipsToUk === 'unknown')).toBe(true);
  });
});

describe('seller identity', () => {
  it('stores a hash and no name anywhere', async () => {
    const listings = await searching().search(plan());
    const serialised = JSON.stringify(listings);

    expect(listings[0]?.sellerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(serialised).not.toContain('seller_001');
    expect(serialised).not.toContain('"username"');
  });

  it('drops the whole seller block from raw, not just the username', async () => {
    const listings = await searching().search(plan());

    for (const listing of listings) {
      expect(listing.raw).not.toHaveProperty('seller');
    }
  });

  it('is the HMAC of the username under the instance salt', async () => {
    const listings = await searching().search(plan());

    expect(listings[0]?.sellerHash).toBe(sellerHash('ebay', 'seller_001', SALT));
  });

  it('gives the same seller the same hash across listings', async () => {
    const listings = await searching('gb-broad-macintosh.json').search(plan());
    const hashes = listings.map((listing) => listing.sellerHash);

    expect(new Set(hashes).size).toBeLessThan(hashes.length);
  });
});

describe('enrich', () => {
  const enriching = (fixture: string) =>
    harness([
      { match: '/item_summary/search', fixture: 'gb-baseline.json' },
      { match: '/buy/browse/v1/item/', fixture },
    ]);

  it('fetches the full description and images', async () => {
    const test = enriching('item-2.json');
    const [first] = await test.search(plan());
    const enriched = await test.enrich(first as never);

    expect(enriched.description).toBeTruthy();
    expect(enriched.images.length).toBeGreaterThan(0);
  });

  it('derives ships-to-UK as yes when the UK is an included country', async () => {
    const test = enriching('item-1.json');
    const [first] = await test.search(plan());

    await expect(test.enrich(first as never)).resolves.toMatchObject({ shipsToUk: 'yes' });
  });

  it('keeps the seller out of an enriched listing too, legal info included', async () => {
    const test = enriching('item-3.json');
    const [first] = await test.search(plan());
    const enriched = await test.enrich(first as never);

    expect(JSON.stringify(enriched)).not.toContain('sellerLegalInfo');
    expect(enriched.raw).not.toHaveProperty('seller');
  });
});

describe('buildFilter', () => {
  it('is empty when there is nothing to filter on', () => {
    expect(buildFilter(plan(), null)).toBe('');
  });

  /** S1-01: eBay answers 200 to `{GB|US}` and silently ignores it, so it is never generated. */
  it('sends itemLocationCountry as a single value, never a set', () => {
    const filter = buildFilter(plan({ options: { itemLocationCountry: 'GB' } }), null);

    expect(filter).toContain('itemLocationCountry:GB');
    expect(filter).not.toContain('{');
  });

  it('ignores an array handed to itemLocationCountry rather than building a set from it', () => {
    const filter = buildFilter(
      plan({ options: { itemLocationCountry: ['GB', 'US'] as never } }),
      null,
    );

    expect(filter).not.toContain('itemLocationCountry');
  });

  it('builds the price ceiling with its currency', () => {
    const filter = buildFilter(plan({ options: { maxPrice: 150 } }), null);

    expect(filter).toContain('price:[..150]');
    expect(filter).toContain('priceCurrency:GBP');
  });
});

describe('healthCheck', () => {
  it('reports the remaining daily quota', async () => {
    const test = harness([
      { match: '/item_summary/search', fixture: 'gb-baseline.json' },
      {
        match: '/rate_limit/',
        body: {
          rateLimits: [
            {
              resources: [
                { rates: [{ limit: 5000, remaining: 4990, reset: '2026-09-14T07:00:00.000Z' }] },
              ],
            },
          ],
        },
      },
    ]);

    const health = await test.healthCheck();

    expect(health.status).toBe('ok');
    expect(health.message).toContain('4990 of 5000');
  });

  it('reports degraded when the quota is nearly spent', async () => {
    const test = harness([
      { match: '/item_summary/search', fixture: 'gb-baseline.json' },
      {
        match: '/rate_limit/',
        body: { rateLimits: [{ resources: [{ rates: [{ limit: 5000, remaining: 10 }] }] }] },
      },
    ]);

    await expect(test.healthCheck()).resolves.toMatchObject({ status: 'degraded' });
  });

  it('still reports ok when the quota endpoint says nothing, as sandbox does', async () => {
    const test = harness([
      { match: '/item_summary/search', fixture: 'gb-baseline.json' },
      { match: '/rate_limit/', body: null, status: 204 },
    ]);

    await expect(test.healthCheck()).resolves.toMatchObject({ status: 'ok' });
  });

  it('reports an error rather than throwing when the credentials are refused', async () => {
    const test = createHarness({
      adapter: ebayAdapter,
      fixturesDir: FIXTURES,
      // A distinct client id: the token cache is module-level and keyed by it, so reusing the
      // one the other tests authenticated with would serve a cached token and never reach the
      // refusal under test.
      credentials: { ...CREDENTIALS, clientId: 'refused-client-id' },
      routes: [
        {
          match: '/identity/v1/oauth2/token',
          body: { error_description: 'client authentication failed' },
          status: 401,
        },
      ],
    });

    const health = await test.healthCheck();

    expect(health.status).toBe('error');
    expect(health.message).toContain('client authentication failed');
  });
});

describe('request pacing', () => {
  /**
   * §5 and P1-04: never more than one request in flight per marketplace. The adapter awaits each
   * page before asking for the next, so this holds by construction — but "by construction" is
   * exactly the kind of property a later refactor breaks silently, so it is pinned here.
   */
  it('never has two requests in flight at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const test = createHarness({
      adapter: ebayAdapter,
      fixturesDir: FIXTURES,
      credentials: CREDENTIALS,
      routes: [TOKEN_ROUTE, pages('gb-page-1.json', 'gb-page-2.json', 'gb-baseline.json')],
    });

    const original = test.ctx.http.fetch.bind(test.ctx.http);
    (test.ctx.http as { fetch: typeof original }).fetch = async (url, init) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await original(url, init);
      } finally {
        inFlight -= 1;
      }
    };

    await test.search(plan(), { cap: 50 });

    expect(peak).toBe(1);
  });
});
