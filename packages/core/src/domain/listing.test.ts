import { describe, expect, it } from 'vitest';
import { normalisedListingSchema } from './listing.js';
import { prefilterOutputSchema, reviewerOutputSchema } from './verdict.js';

const MINIMAL = {
  source: 'ebay',
  externalId: 'v1|900000000001|0',
  url: 'https://www.ebay.co.uk/itm/900000000001',
  title: 'Carmageddon big box PC CD-ROM',
};

describe('normalisedListingSchema', () => {
  it('accepts the minimum an adapter can be sure of and defaults the rest', () => {
    const listing = normalisedListingSchema.parse(MINIMAL);

    expect(listing.shipsToUk).toBe('unknown');
    expect(listing.priceAmount).toBeNull();
    expect(listing.images).toEqual([]);
  });

  /**
   * S1-01 found eBay reports no `price` on an auction and puts the figure in `currentBidPrice`.
   * A null must stay expressible, so the hard filter can tell "no price known" from "free".
   */
  it('allows a null price, which is what an un-normalised auction looks like', () => {
    expect(normalisedListingSchema.parse({ ...MINIMAL, priceAmount: null }).priceAmount).toBeNull();
  });

  it('still rejects a negative price', () => {
    expect(normalisedListingSchema.safeParse({ ...MINIMAL, priceAmount: -1 }).success).toBe(false);
  });

  it('has nowhere to put a seller name, only a hash (§4)', () => {
    const parsed = normalisedListingSchema.parse({
      ...MINIMAL,
      sellerHash: 'a'.repeat(64),
      sellerName: 'collector99',
      seller: { username: 'collector99' },
    } as Record<string, unknown>);

    expect(parsed.sellerHash).toBe('a'.repeat(64));
    expect(parsed).not.toHaveProperty('sellerName');
    expect(parsed).not.toHaveProperty('seller');
  });

  it('rejects a country code that is not two letters, so EBAY_GB cannot be mistaken for one', () => {
    expect(
      normalisedListingSchema.safeParse({ ...MINIMAL, itemLocationCountry: 'EBAY_GB' }).success,
    ).toBe(false);
    expect(
      normalisedListingSchema.safeParse({ ...MINIMAL, itemLocationCountry: 'GB' }).success,
    ).toBe(true);
  });

  it('coerces the dates an adapter hands over as ISO strings', () => {
    const listing = normalisedListingSchema.parse({
      ...MINIMAL,
      listedAt: '2026-09-12T19:01:01.000Z',
    });

    expect(listing.listedAt).toBeInstanceOf(Date);
  });
});

describe('reviewerOutputSchema', () => {
  it('has no decision field: §7 step 6 decides, the model does not', () => {
    const output = reviewerOutputSchema.parse({
      criteriaResults: [{ criterionId: 'big-box', result: 'pass', evidence: 'Box visible' }],
      englishSummary: 'A boxed copy.',
      shipsToUk: 'unknown',
      grade: null,
    });

    expect(output).not.toHaveProperty('decision');
    expect(output.shipsToUk).toBe('unknown');
  });

  it('rejects a per-criterion result outside pass/fail/unknown', () => {
    const result = reviewerOutputSchema.safeParse({
      criteriaResults: [{ criterionId: 'big-box', result: 'probably', evidence: '' }],
      englishSummary: '',
      shipsToUk: 'unknown',
      grade: null,
    });

    expect(result.success).toBe(false);
  });

  /**
   * No field a model fills in may be optional: an optional field is left out of the JSON Schema's
   * `required` list, and OpenAI refuses the whole schema. `model-schemas.test.ts` proves the rule
   * holds across every model-facing schema; this pins the consequence for the reviewer.
   */
  it('insists the model answers every field rather than defaulting one in', () => {
    const missing = reviewerOutputSchema.safeParse({
      criteriaResults: [{ criterionId: 'big-box', result: 'pass', evidence: 'Box visible' }],
    });

    expect(missing.success).toBe(false);
  });

  it('expresses "not graded yet" as null rather than as absent', () => {
    const output = reviewerOutputSchema.parse({
      criteriaResults: [],
      englishSummary: '',
      shipsToUk: 'yes',
      grade: null,
    });

    expect(output.grade).toBeNull();
  });
});

describe('prefilterOutputSchema', () => {
  it('is the cheap two-field shape from §7 step 3, with both required', () => {
    expect(prefilterOutputSchema.parse({ plausible: true, reason: 'A boxed copy.' })).toEqual({
      plausible: true,
      reason: 'A boxed copy.',
    });

    expect(prefilterOutputSchema.safeParse({ plausible: true }).success).toBe(false);
  });
});
