import { describe, expect, it } from 'vitest';
import { wishSaveSchema } from './schema.js';

describe('wishSaveSchema', () => {
  it('takes a label alone: no category, no link, no tags', () => {
    expect(wishSaveSchema.parse({ label: '  Jurassic Park  ' })).toEqual({
      label: 'Jurassic Park',
      categoryId: null,
      searchUrl: null,
      tags: [],
    });
  });

  it('tidies its tags', () => {
    expect(
      wishSaveSchema.parse({
        label: 'x',
        tags: [' big box', '', 'Big Box', '90s'],
      }).tags,
    ).toEqual(['big box', '90s']);
  });

  it('keeps an http or https link', () => {
    const url = 'https://www.ebay.co.uk/sch/i.html?_nkw=jurassic+park+vhs';

    expect(wishSaveSchema.parse({ label: 'x', searchUrl: url }).searchUrl).toBe(url);
    expect(wishSaveSchema.parse({ label: 'x', searchUrl: 'http://example.com' }).searchUrl).toBe(
      'http://example.com',
    );
  });

  it('reads an empty link as no link', () => {
    expect(wishSaveSchema.parse({ label: 'x', searchUrl: '  ' }).searchUrl).toBe(null);
    expect(wishSaveSchema.parse({ label: 'x', searchUrl: null }).searchUrl).toBe(null);
  });

  /** The link becomes an `href`, and these would run script in the app's origin when clicked. */
  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/file',
    'ebay.co.uk',
  ])('refuses %s as a link', (searchUrl) => {
    expect(wishSaveSchema.safeParse({ label: 'x', searchUrl }).success).toBe(false);
  });

  it('needs a label, and a category only as an id', () => {
    expect(wishSaveSchema.safeParse({ label: ' ' }).success).toBe(false);
    expect(wishSaveSchema.safeParse({ label: 'x', categoryId: 'vinyl' }).success).toBe(false);
    expect(
      wishSaveSchema.safeParse({ label: 'x', categoryId: '5b1f6c1e-6f0e-4b8a-9d1e-2f3a4b5c6d7e' })
        .success,
    ).toBe(true);
  });
});
