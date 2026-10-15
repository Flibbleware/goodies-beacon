import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EBAY_MARKETPLACES,
  sellerCountryOf,
  unknownRegions,
  withListingTypes,
  withSellerCountry,
} from './regions.js';
import { wantedSpecSchema } from './spec.js';

const example = (name: string) =>
  wantedSpecSchema.parse(
    JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')),
  );

describe('unknownRegions', () => {
  it('finds nothing wrong in either worked example', () => {
    expect(unknownRegions(example('carmageddon').searchPlans)).toEqual([]);
    expect(unknownRegions(example('power-mac-5500').searchPlans)).toEqual([]);
  });

  it('accepts every eBay marketplace', () => {
    const plans = EBAY_MARKETPLACES.map(({ value }) => ({
      source: 'ebay' as const,
      region: value,
    }));

    expect(plans).toHaveLength(9);
    expect(unknownRegions(plans)).toEqual([]);
  });

  it('refuses a list, a lowercase id and a Vinted domain on eBay, by position', () => {
    const issues = unknownRegions([
      { source: 'ebay', region: 'EBAY_GB' },
      { source: 'ebay', region: 'EBAY_GB, EBAY_US' },
      { source: 'ebay', region: 'ebay_us' },
      { source: 'ebay', region: 'vinted.co.uk' },
    ]);

    expect(issues.map((issue) => issue.index)).toEqual([1, 2, 3]);
    expect(issues[0]?.message).toBe(
      '“EBAY_GB, EBAY_US” is not a region ebay can search. A plan searches one of EBAY_GB, EBAY_US, EBAY_DE, EBAY_FR, EBAY_IT, EBAY_ES, EBAY_AU, EBAY_CA, EBAY_IE; add a plan for each.',
    );
  });

  it('leaves alone a source whose regions are not known yet', () => {
    expect(
      unknownRegions([
        { source: 'vinted', region: 'vinted.fr' },
        { source: 'mercari_jp', region: 'jp' },
        { source: '_template', region: 'example' },
      ]),
    ).toEqual([]);
  });
});

describe('the seller country a plan searches with (P1-36)', () => {
  const ebay = (options: Record<string, unknown> = {}) => ({ source: 'ebay' as const, options });

  it("uses the plan's own country, or else the item's, or anywhere", () => {
    expect(sellerCountryOf(ebay({ itemLocationCountry: 'DE' }), 'GB')).toBe('DE');
    expect(sellerCountryOf(ebay(), 'GB')).toBe('GB');
    expect(sellerCountryOf(ebay(), null)).toBeNull();
  });

  it('writes the item country into a plan without its own, and leaves the rest of it alone', () => {
    const plan = { ...ebay({ conditions: ['USED'] }), id: 'p', query: 'q' };

    expect(withSellerCountry(plan, 'GB')).toEqual({
      ...plan,
      options: { conditions: ['USED'], itemLocationCountry: 'GB' },
    });
    expect(withSellerCountry(plan, null)).toBe(plan);
  });

  it('asks nothing of a source whose search cannot filter by seller country', () => {
    const vinted = { source: 'vinted' as const, options: {} };

    expect(sellerCountryOf(vinted, 'GB')).toBeNull();
    expect(withSellerCountry(vinted, 'GB')).toBe(vinted);
  });
});

describe('withListingTypes', () => {
  const ebay = (options: Record<string, unknown> = {}) => ({ source: 'ebay' as const, options });

  /** eBay's search returns no plain auction unless asked for one, so both are always named. */
  it('asks eBay for every listing type the item allows', () => {
    expect(withListingTypes(ebay(), ['auction', 'fixed']).options).toEqual({
      buyingOptions: ['AUCTION', 'FIXED_PRICE'],
    });
    expect(withListingTypes(ebay({ conditions: ['USED'] }), ['auction']).options).toEqual({
      conditions: ['USED'],
      buyingOptions: ['AUCTION'],
    });
  });

  it("keeps a plan's own buying options, and leaves a source that has none alone", () => {
    const own = ebay({ buyingOptions: ['FIXED_PRICE'] });
    const vinted = { source: 'vinted' as const, options: {} };

    expect(withListingTypes(own, ['auction', 'fixed'])).toBe(own);
    expect(withListingTypes(vinted, ['auction'])).toBe(vinted);
  });
});
