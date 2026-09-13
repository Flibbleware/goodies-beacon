import { describe, expect, it } from 'vitest';
import { deriveShipsToUk } from './ships-to-uk.js';

const country = (regionId: string, regionName = regionId) => ({
  regionId,
  regionName,
  regionType: 'COUNTRY',
});

describe('deriveShipsToUk', () => {
  it('says yes when the UK is an included country', () => {
    expect(deriveShipsToUk({ regionIncluded: [country('GB', 'United Kingdom')] })).toBe('yes');
  });

  it('says no when countries are listed and the UK is not among them', () => {
    expect(deriveShipsToUk({ regionIncluded: [country('US'), country('CA')] })).toBe('no');
  });

  it('says no when the UK is explicitly excluded, even from a worldwide offer', () => {
    expect(
      deriveShipsToUk({
        regionIncluded: [{ regionType: 'WORLDWIDE', regionName: 'Worldwide' }],
        regionExcluded: [country('GB')],
      }),
    ).toBe('no');
  });

  /**
   * Shapes the three recorded items did not contain — S1-01's sample was all `COUNTRY` — so these
   * are handled from eBay's schema rather than from evidence, and are worth pinning down.
   */
  it('says yes for a worldwide offer', () => {
    expect(deriveShipsToUk({ regionIncluded: [{ regionType: 'WORLDWIDE' }] })).toBe('yes');
  });

  it('says yes for a world region that contains the UK', () => {
    expect(
      deriveShipsToUk({
        regionIncluded: [{ regionType: 'WORLD_REGION', regionId: 'EUROPE', regionName: 'Europe' }],
      }),
    ).toBe('yes');
  });

  it('ignores a sub-national exclusion, which says nothing about the country', () => {
    expect(
      deriveShipsToUk({
        regionIncluded: [country('GB')],
        regionExcluded: [
          { regionType: 'COUNTRY_REGION', regionId: '_AH', regionName: 'Alaska/Hawaii' },
        ],
      }),
    ).toBe('yes');
  });

  /**
   * The three-valued flag exists so an unreadable answer surfaces the listing rather than hiding
   * it (§1: show the flag, do not filter on it). A wrong `no` is the expensive mistake.
   */
  it('says unknown rather than guessing when there is nothing to read', () => {
    expect(deriveShipsToUk(undefined)).toBe('unknown');
    expect(deriveShipsToUk(null)).toBe('unknown');
    expect(deriveShipsToUk({})).toBe('unknown');
    expect(deriveShipsToUk({ regionIncluded: [] })).toBe('unknown');
  });

  it('says unknown when every included region is a shape it does not understand', () => {
    expect(
      deriveShipsToUk({
        regionIncluded: [
          { regionType: 'GALACTIC_SECTOR', regionId: 'ZZ9', regionName: 'Plural Z' },
        ],
      }),
    ).toBe('unknown');
  });

  it('still says yes when an understood region sits beside one it does not', () => {
    expect(
      deriveShipsToUk({
        regionIncluded: [{ regionType: 'GALACTIC_SECTOR', regionId: 'ZZ9' }, country('GB')],
      }),
    ).toBe('yes');
  });

  it('accepts UK as well as GB, since eBay uses both spellings for the region id', () => {
    expect(deriveShipsToUk({ regionIncluded: [country('UK', 'United Kingdom')] })).toBe('yes');
  });
});
