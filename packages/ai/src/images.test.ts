import { describe, expect, it } from 'vitest';
import {
  buildReviewPrompt,
  countImages,
  RemoteImageError,
  type ReviewPromptInput,
  UnsupportedStrategyError,
} from './images.js';

function input(overrides: Partial<ReviewPromptInput> = {}): ReviewPromptInput {
  return {
    stable: {
      instructions: 'Judge the listing against the criteria.',
      specSummary: 'Carmageddon, big box PC release.',
      criteria: '1. Big box, not a jewel case.',
      referenceImages: [
        { image: 'data:image/jpeg;base64,BIGBOX', label: 'Big box, front' },
        { image: 'data:image/jpeg;base64,JEWEL', label: 'Jewel case, for contrast' },
      ],
      ...overrides.stable,
    },
    listing: {
      text: 'Carmageddon PC CD-ROM, complete',
      images: [{ image: 'data:image/jpeg;base64,LISTING', label: '' }],
      ...overrides.listing,
    },
    ...(overrides.strategy ? { strategy: overrides.strategy } : {}),
  };
}

describe('buildReviewPrompt', () => {
  /**
   * The whole point of the ordering (§9): everything identical across an item's candidates comes
   * first, so a provider that caches prompt prefixes charges a tenth for it from the second
   * listing onwards. Reversing these two costs nothing on the first and everything after.
   */
  it('puts everything stable before anything about the listing', () => {
    const parts = buildReviewPrompt(input());
    const listingAt = parts.findIndex(
      (part) => part.type === 'text' && part.text.includes('Carmageddon PC CD-ROM'),
    );

    const stableAfterListing = parts
      .slice(listingAt + 1)
      .filter((part) => part.type === 'file' && part.data === 'data:image/jpeg;base64,BIGBOX');

    expect(listingAt).toBeGreaterThan(0);
    expect(stableAfterListing).toHaveLength(0);
  });

  it('sends each reference image with its label, under the separate strategy', () => {
    const parts = buildReviewPrompt(input());
    const labelAt = parts.findIndex(
      (part) => part.type === 'text' && part.text === 'Big box, front',
    );

    expect(labelAt).toBeGreaterThan(-1);
    // The caption comes first: a model reads parts in order, and a label after the picture has to
    // be attached to it retrospectively.
    expect(parts[labelAt + 1]).toMatchObject({
      type: 'file',
      data: 'data:image/jpeg;base64,BIGBOX',
    });
  });

  it('sends an unlabelled listing photo without an empty caption before it', () => {
    const parts = buildReviewPrompt(input());
    const listingImageAt = parts.findIndex(
      (part) => part.type === 'file' && part.data === 'data:image/jpeg;base64,LISTING',
    );

    expect(parts[listingImageAt - 1]).toMatchObject({ type: 'text' });
    expect((parts[listingImageAt - 1] as { text: string }).text).toContain('Carmageddon PC CD-ROM');
  });

  it('drops an empty section rather than sending a blank block', () => {
    const parts = buildReviewPrompt(
      input({
        stable: {
          instructions: 'Judge it.',
          specSummary: '',
          criteria: '   ',
          referenceImages: [],
        },
      }),
    );

    expect(parts.filter((part) => part.type === 'text' && part.text.trim() === '')).toHaveLength(0);
  });

  it('carries grade examples in the stable half, where Phase 5 will want them', () => {
    const parts = buildReviewPrompt(
      input({
        stable: {
          instructions: 'Judge it.',
          specSummary: 'spec',
          criteria: 'criteria',
          referenceImages: [],
          gradeImages: [{ image: 'data:image/jpeg;base64,MINT', label: 'Mint' }],
        },
      }),
    );

    const gradeAt = parts.findIndex((part) => part.type === 'text' && part.text === 'Mint');
    const listingAt = parts.findIndex(
      (part) => part.type === 'text' && part.text.includes('Carmageddon PC CD-ROM'),
    );

    expect(gradeAt).toBeGreaterThan(-1);
    expect(gradeAt).toBeLessThan(listingAt);
  });

  /**
   * Refusing beats silently sending `separate`: someone who turned the setting on believes it is
   * saving them money, and a quiet fallback would bill them as though it were not set.
   */
  it('refuses the contact sheet rather than pretending to honour it', () => {
    expect(() => buildReviewPrompt(input({ strategy: 'contact_sheet' }))).toThrow(
      UnsupportedStrategyError,
    );
    expect(() => buildReviewPrompt(input({ strategy: 'contact_sheet' }))).toThrow(/Phase 5/);
  });

  /**
   * The SDK resolves a remote URL by fetching it, which would send a marketplace-supplied address
   * out of the worker with none of §12's protections — no private-address block list, no size cap.
   * P1-05 exists to do that fetch under guard, so a prompt takes the bytes it stored.
   */
  it('refuses a remote image URL, which the SDK would otherwise fetch unguarded', () => {
    const remote = input({
      listing: {
        text: 'listing',
        images: [{ image: 'https://example.invalid/listing.jpg', label: '' }],
      },
    });

    expect(() => buildReviewPrompt(remote)).toThrow(RemoteImageError);
    expect(() => buildReviewPrompt(remote)).toThrow(/media ingest/);
  });

  it('accepts raw bytes as readily as a data URI', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const parts = buildReviewPrompt(
      input({ listing: { text: 'listing', images: [{ image: bytes, label: '' }] } }),
    );

    expect(parts.at(-1)).toMatchObject({ type: 'file', data: bytes });
  });
});

describe('countImages', () => {
  /** §7's running "images per review" count, which the item page nudges at six. */
  it('counts every image a review would carry', () => {
    expect(countImages(input())).toBe(3);
  });

  it('includes grade examples', () => {
    const counted = countImages(
      input({
        stable: {
          instructions: 'x',
          specSummary: 'x',
          criteria: 'x',
          referenceImages: [{ image: 'a', label: '' }],
          gradeImages: [
            { image: 'b', label: '' },
            { image: 'c', label: '' },
          ],
        },
      }),
    );

    expect(counted).toBe(4);
  });
});
