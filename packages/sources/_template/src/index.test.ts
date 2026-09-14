import { fileURLToPath } from 'node:url';
import { createHarness, type SearchPlan, UnmatchedRequestError } from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { templateAdapter } from './index.js';

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

const PLAN: SearchPlan = {
  id: 'plan-1',
  source: '_template',
  query: 'carmageddon',
  region: 'example',
  options: {},
  enabled: true,
  watermark: null,
};

const harness = (routes = [{ match: '/search', fixture: 'search.json' }]) =>
  createHarness({ adapter: templateAdapter, fixturesDir: FIXTURES, routes });

describe('the template adapter', () => {
  it('returns listings the pipeline can store', async () => {
    const listings = await harness().search(PLAN);

    // Newest first, as the source returns them.
    expect(listings.map((listing) => listing.externalId)).toEqual([
      'tmpl-1002',
      'tmpl-1001',
      'tmpl-1003',
    ]);
    expect(listings[0]?.title).toContain('Carmageddon');
  });

  it('normalises an auction price, which the source reports as a bid rather than a price', async () => {
    const [auction] = await harness().search(PLAN);

    expect(auction?.buyingType).toBe('auction');
    expect(auction?.priceAmount).toBe(3.2);
    expect(auction?.priceCurrency).toBe('GBP');
    expect(auction?.endsAt).toBeInstanceOf(Date);
  });

  it('hashes the seller and keeps no name anywhere', async () => {
    const listings = await harness().search(PLAN);
    const serialised = JSON.stringify(listings);

    expect(listings[0]?.sellerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(serialised).not.toContain('example_seller_a');
    expect(serialised).not.toContain('example_seller_b');
    expect(serialised).not.toContain('handle');
  });

  it('gives two listings by one seller the same hash, which relist detection needs', async () => {
    const listings = await harness().search(PLAN);

    // tmpl-1001 and tmpl-1003 are both seller_a; tmpl-1002 is seller_b.
    expect(listings[1]?.sellerHash).toBe(listings[2]?.sellerHash);
    expect(listings[1]?.sellerHash).not.toBe(listings[0]?.sellerHash);
  });

  it('stops at the watermark instead of returning everything and filtering later', async () => {
    const since = new Date('2026-09-12T09:00:00.000Z');
    const listings = await harness().search(PLAN, { since });

    // The third listing predates the watermark, so the walk stopped there rather than paging on.
    expect(listings.map((listing) => listing.externalId)).toEqual(['tmpl-1002', 'tmpl-1001']);
  });

  it('honours the per-poll cap so a broad query cannot flood the reviewer', async () => {
    const listings = await harness().search(PLAN, { cap: 2 });

    expect(listings).toHaveLength(2);
  });

  /**
   * The ceiling a capped poll leaves behind (P1-07). The harness replays one fixture whatever the
   * URL asks for, so the adapter's own filtering is what is under test here, not the fixture's.
   */
  it('skips anything at or above the ceiling a capped run left behind', async () => {
    const until = new Date('2026-09-12T11:40:00.000Z');
    const test = harness();
    const listings = await test.search(PLAN, {
      since: new Date('2026-09-11T00:00:00.000Z'),
      until,
    });

    expect(listings.map((listing) => listing.externalId)).toEqual(['tmpl-1001', 'tmpl-1003']);
    expect(new URL(test.requests[0] as string).searchParams.get('before')).toBe(
      '2026-09-12T11:40:00.000Z',
    );
  });

  it('copes with an empty result', async () => {
    const listings = await harness([{ match: '/search', fixture: 'search-empty.json' }]).search(
      PLAN,
    );

    expect(listings).toEqual([]);
  });

  it('sends the query, region and watermark the plan asked for', async () => {
    const test = harness();
    await test.search(PLAN, { since: new Date('2026-09-01T00:00:00.000Z') });

    const url = new URL(test.requests[0] as string);
    expect(url.searchParams.get('q')).toBe('carmageddon');
    expect(url.searchParams.get('region')).toBe('example');
    expect(url.searchParams.get('since')).toBe('2026-09-01T00:00:00.000Z');
  });

  it('fills in the description and every image on enrich', async () => {
    const test = createHarness({
      adapter: templateAdapter,
      fixturesDir: FIXTURES,
      routes: [
        { match: '/search', fixture: 'search.json' },
        { match: '/listing/', fixture: 'item.json' },
      ],
    });

    const [first] = await test.search(PLAN);
    const enriched = await test.enrich(first as never);

    expect(enriched.description).toContain('big box');
    expect(enriched.images).toHaveLength(2);
    expect(enriched.shipsToUk).toBe('yes');
  });

  it('reports health from a real request', async () => {
    await expect(harness().healthCheck()).resolves.toMatchObject({ status: 'ok' });
  });

  it('reports blocked rather than error on a 403, which is what §5 asks the UI to show', async () => {
    const test = createHarness({
      adapter: templateAdapter,
      fixturesDir: FIXTURES,
      routes: [{ match: '/search', body: {}, status: 403 }],
    });

    await expect(test.healthCheck()).resolves.toMatchObject({ status: 'blocked' });
  });
});

describe('the harness itself', () => {
  it('fails loudly on a request with no fixture rather than quietly returning nothing', async () => {
    const test = createHarness({
      adapter: templateAdapter,
      fixturesDir: FIXTURES,
      routes: [{ match: '/nothing-like-this', fixture: 'search.json' }],
    });

    await expect(test.search(PLAN)).rejects.toBeInstanceOf(UnmatchedRequestError);
  });

  it('rejects an adapter that returns something the pipeline could not store', async () => {
    const broken = {
      ...templateAdapter,
      async search() {
        return [{ source: '_template', externalId: '', url: 'not-a-url', title: '' }] as never;
      },
    };
    const test = createHarness({ adapter: broken, fixturesDir: FIXTURES, routes: [] });

    await expect(test.search(PLAN)).rejects.toThrow(/unusable listing at index 0/);
  });
});
