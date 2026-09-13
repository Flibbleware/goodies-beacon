import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintSpec } from './lint.js';
import { specSettingsSchema, wantedSpecSchema } from './spec.js';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const EXAMPLES = ['carmageddon', 'power-mac-5500'] as const;

describe.each(EXAMPLES)('the %s example spec', (name) => {
  const raw = load(name);

  it('parses', () => {
    expect(() => wantedSpecSchema.parse(raw)).not.toThrow();
  });

  /**
   * The round trip is the real test: P1-13 stores a spec as JSONB and reads it back on every
   * poll, so anything the schema silently drops or retypes would be lost between versions.
   */
  it('round-trips through parse and JSON without losing or changing anything', () => {
    const parsed = wantedSpecSchema.parse(raw);
    const reparsed = wantedSpecSchema.parse(JSON.parse(JSON.stringify(parsed)));

    expect(JSON.parse(JSON.stringify(reparsed))).toEqual(JSON.parse(JSON.stringify(parsed)));
  });

  it('keeps every criterion and search plan', () => {
    const parsed = wantedSpecSchema.parse(raw);
    const source = raw as { criteria: unknown[]; searchPlans: unknown[] };

    expect(parsed.criteria).toHaveLength(source.criteria.length);
    expect(parsed.searchPlans).toHaveLength(source.searchPlans.length);
  });

  it('expresses its bounded values as settings rather than criteria', () => {
    const warnings = lintSpec(wantedSpecSchema.parse(raw));
    const leaks = warnings.filter((warning) => warning.code !== 'hard_non_quantifiable');

    expect(leaks).toEqual([]);
  });
});

describe('specSettingsSchema', () => {
  it('fills in the v1 defaults from §4 when given an empty object', () => {
    const settings = specSettingsSchema.parse({});

    expect(settings.shipsToUk).toBe('show_all');
    expect(settings.relists).toBe('show');
    expect(settings.defaultOnUnknown).toBe('surface');
    expect(settings.priceCeiling).toBeNull();
    expect(settings.listingTypes).toEqual(['auction', 'fixed']);
  });

  it('rejects a price ceiling in a currency other than GBP, since §4 compares in GBP', () => {
    const result = specSettingsSchema.safeParse({
      priceCeiling: { amount: 120, currency: 'USD' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an item that allows no listing type at all', () => {
    expect(specSettingsSchema.safeParse({ listingTypes: [] }).success).toBe(false);
  });

  it('rejects a poll interval that is not an ISO 8601 duration', () => {
    expect(specSettingsSchema.safeParse({ pollEvery: '8 hours' }).success).toBe(false);
    expect(specSettingsSchema.safeParse({ pollEvery: 'PT8H' }).success).toBe(true);
  });

  it('names the offending path, which is what the P1-13 editor shows', () => {
    const result = specSettingsSchema.safeParse({ priceCeiling: { amount: -5, currency: 'GBP' } });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['priceCeiling', 'amount']);
  });
});
