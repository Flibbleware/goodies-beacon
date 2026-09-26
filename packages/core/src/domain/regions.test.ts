import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EBAY_MARKETPLACES, unknownRegions } from './regions.js';
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
