import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, countryName } from './countries.js';
import { specSettingsSchema } from './spec.js';

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

  it('takes ISO codes and refuses a grouping or a retired code', () => {
    expect(specSettingsSchema.parse({ excludedCountries: ['JP', 'CN'] }).excludedCountries).toEqual(
      ['JP', 'CN'],
    );
    expect(specSettingsSchema.safeParse({ excludedCountries: ['EU'] }).success).toBe(false);
    expect(specSettingsSchema.safeParse({ excludedCountries: ['SU'] }).success).toBe(false);
  });
});
