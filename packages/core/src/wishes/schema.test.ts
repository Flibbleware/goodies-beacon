import { describe, expect, it } from 'vitest';
import { wishSaveSchema } from './schema.js';

describe('wishSaveSchema', () => {
  it('takes a label and a category, and no link', () => {
    expect(wishSaveSchema.parse({ label: '  Jurassic Park  ', category: 'vhs' })).toEqual({
      label: 'Jurassic Park',
      category: 'vhs',
      searchUrl: null,
    });
  });

  it('keeps an http or https link', () => {
    const url = 'https://www.ebay.co.uk/sch/i.html?_nkw=jurassic+park+vhs';

    expect(wishSaveSchema.parse({ label: 'x', category: 'vhs', searchUrl: url }).searchUrl).toBe(
      url,
    );
    expect(
      wishSaveSchema.parse({ label: 'x', category: 'vhs', searchUrl: 'http://example.com' })
        .searchUrl,
    ).toBe('http://example.com');
  });

  it('reads an empty link as no link', () => {
    expect(wishSaveSchema.parse({ label: 'x', category: 'toy', searchUrl: '  ' }).searchUrl).toBe(
      null,
    );
    expect(wishSaveSchema.parse({ label: 'x', category: 'toy', searchUrl: null }).searchUrl).toBe(
      null,
    );
  });

  /** The link becomes an `href`, and these would run script in the app's origin when clicked. */
  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/file',
    'ebay.co.uk',
  ])('refuses %s as a link', (searchUrl) => {
    expect(wishSaveSchema.safeParse({ label: 'x', category: 'game', searchUrl }).success).toBe(
      false,
    );
  });

  it('needs a label and one of the categories', () => {
    expect(wishSaveSchema.safeParse({ label: ' ', category: 'game' }).success).toBe(false);
    expect(wishSaveSchema.safeParse({ label: 'x', category: 'vinyl' }).success).toBe(false);
  });
});
