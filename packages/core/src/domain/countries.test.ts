import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, countryName } from './countries.js';
import { searchPlanSchema, specSettingsSchema } from './spec.js';

describe('the country list', () => {
  it('is the 249 codes of ISO 3166-1, each once, each with a name', () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    for (const code of COUNTRY_CODES) expect(countryName(code)).not.toBe(code);
  });

  it('names a country in English, whatever case the code arrives in', () => {
    expect(countryName('JP')).toBe('Japan');
    expect(countryName('gb')).toBe('United Kingdom');
  });
});

describe('excludedCountries', () => {
  it('defaults to none, so a spec written before P1-35 still parses', () => {
    expect(specSettingsSchema.parse({}).excludedCountries).toEqual([]);
  });

  it('has an item-wide seller country beside it, anywhere unless set (P1-36)', () => {
    expect(specSettingsSchema.parse({}).sellerCountry).toBeNull();
    expect(specSettingsSchema.parse({ sellerCountry: 'GB' }).sellerCountry).toBe('GB');
    expect(specSettingsSchema.safeParse({ sellerCountry: 'EU' }).success).toBe(false);
  });

  it('takes ISO codes and refuses a grouping or a retired code', () => {
    expect(specSettingsSchema.parse({ excludedCountries: ['JP', 'CN'] }).excludedCountries).toEqual(
      ['JP', 'CN'],
    );
    expect(specSettingsSchema.safeParse({ excludedCountries: ['EU'] }).success).toBe(false);
    expect(specSettingsSchema.safeParse({ excludedCountries: ['SU'] }).success).toBe(false);
  });
});

describe("a search plan's seller country (P1-36)", () => {
  const plan = (options: Record<string, unknown>) =>
    searchPlanSchema.safeParse({
      id: 'ebay-gb-carmageddon',
      source: 'ebay',
      query: 'carmageddon',
      region: 'EBAY_GB',
      options,
    });

  it('takes an ISO code, or none', () => {
    expect(plan({ itemLocationCountry: 'GB' }).success).toBe(true);
    expect(plan({}).success).toBe(true);
  });

  it('reads a code written in lower case, so one saved before the check still polls', () => {
    expect(plan({ itemLocationCountry: 'gb' }).data?.options).toEqual({
      itemLocationCountry: 'GB',
    });
  });

  it('refuses anything else, beside the option it belongs to', () => {
    const set = plan({ itemLocationCountry: '{GB|US}' });
    expect(set.success).toBe(false);
    expect(set.error?.issues[0]?.path).toEqual(['options', 'itemLocationCountry']);
    expect(plan({ itemLocationCountry: 'UK' }).success).toBe(false);
  });
});
