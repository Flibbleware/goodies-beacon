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
    expect(settings.priceRange).toEqual({ min: null, max: null, currency: 'GBP' });
    expect(settings.matchNotifications).toBe('digest');
    expect(settings.uncertainNotifications).toBe('digest');
    expect(settings.listingTypes).toEqual(['auction', 'fixed']);
  });

  it('rejects a price range in a currency other than GBP, since §4 compares in GBP', () => {
    const result = specSettingsSchema.safeParse({
      priceRange: { min: null, max: 120, currency: 'USD' },
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
    const result = specSettingsSchema.safeParse({ priceRange: { max: -5 } });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['priceRange', 'max']);
  });

  it('takes either end of the price range alone, and refuses a maximum under the minimum', () => {
    expect(specSettingsSchema.parse({ priceRange: { min: 20 } }).priceRange).toEqual({
      min: 20,
      max: null,
      currency: 'GBP',
    });
    expect(specSettingsSchema.safeParse({ priceRange: { min: 0, max: 50 } }).success).toBe(true);
    expect(specSettingsSchema.safeParse({ priceRange: { min: 50, max: 50 } }).success).toBe(true);
    expect(specSettingsSchema.safeParse({ priceRange: { min: -1 } }).success).toBe(false);

    const result = specSettingsSchema.safeParse({ priceRange: { min: 60, max: 50 } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['priceRange', 'max']);
  });

  it('notifies a match and an uncertain verdict each by email, digest or not at all', () => {
    const settings = specSettingsSchema.parse({
      matchNotifications: 'email',
      uncertainNotifications: 'none',
    });
    expect(settings).toMatchObject({ matchNotifications: 'email', uncertainNotifications: 'none' });
    expect(specSettingsSchema.safeParse({ matchNotifications: 'realtime' }).success).toBe(false);
  });
});

describe('a spec written before P1-37', () => {
  const legacy = (settings: Record<string, unknown>) =>
    wantedSpecSchema.parse({ settings }).settings;

  it('reads the price ceiling as the maximum of the range', () => {
    expect(legacy({ priceCeiling: { amount: 120, currency: 'GBP' } }).priceRange).toEqual({
      min: null,
      max: 120,
      currency: 'GBP',
    });
    expect(legacy({ priceCeiling: null }).priceRange).toEqual({
      min: null,
      max: null,
      currency: 'GBP',
    });
  });

  it('still refuses a ceiling in another currency', () => {
    const result = wantedSpecSchema.safeParse({
      settings: { priceCeiling: { amount: 120, currency: 'USD' } },
    });
    expect(result.success).toBe(false);
  });

  it('reads one notification mode as both, real-time being email', () => {
    expect(legacy({ notificationMode: 'realtime' })).toMatchObject({
      matchNotifications: 'email',
      uncertainNotifications: 'email',
    });
    expect(legacy({ notificationMode: 'digest' })).toMatchObject({
      matchNotifications: 'digest',
      uncertainNotifications: 'digest',
    });
  });

  it('lets a field already written in its new form win over the old key', () => {
    const settings = legacy({
      notificationMode: 'realtime',
      matchNotifications: 'none',
      priceCeiling: { amount: 120, currency: 'GBP' },
      priceRange: { min: 10, max: null, currency: 'GBP' },
    });
    expect(settings).toMatchObject({
      matchNotifications: 'none',
      uncertainNotifications: 'email',
      priceRange: { min: 10, max: null },
    });
  });

  it('drops the old keys once read', () => {
    const settings = legacy({ notificationMode: 'digest', priceCeiling: null });
    expect(settings).not.toHaveProperty('notificationMode');
    expect(settings).not.toHaveProperty('priceCeiling');
  });
});
