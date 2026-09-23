import { describe, expect, it } from 'vitest';
import { joinTags, matchesTag, splitTags, tagsSchema } from './tags.js';

describe('tagsSchema', () => {
  it('trims, drops empties, and keeps the first spelling of a repeat', () => {
    expect(tagsSchema.parse(splitTags(' big box , 90s,, Big Box ,Spielberg, '))).toEqual([
      'big box',
      '90s',
      'Spielberg',
    ]);
  });

  it('reads an empty field as no tags', () => {
    expect(tagsSchema.parse(splitTags(''))).toEqual([]);
    expect(tagsSchema.parse([])).toEqual([]);
  });

  it('refuses a tag holding a comma, since the form would split it in two', () => {
    expect(tagsSchema.safeParse(['big, box']).success).toBe(false);
  });

  it('refuses a long tag and too many tags', () => {
    expect(tagsSchema.safeParse(['x'.repeat(41)]).success).toBe(false);
    expect(tagsSchema.safeParse(['x'.repeat(40)]).success).toBe(true);
    expect(tagsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `t${i}`)).success).toBe(false);
    // Twenty-one entries that tidy down to twenty are fine: the count is of what is kept.
    expect(
      tagsSchema.safeParse([...Array.from({ length: 20 }, (_, i) => `t${i}`), 'T0']).success,
    ).toBe(true);
  });

  it('round-trips through the form field', () => {
    const tags = ['big box', '90s'];
    expect(tagsSchema.parse(splitTags(joinTags(tags)))).toEqual(tags);
  });
});

describe('matchesTag', () => {
  const tags = ['Big box', 'Spielberg'];

  it('matches part of any tag, ignoring case', () => {
    expect(matchesTag(tags, 'spiel')).toBe(true);
    expect(matchesTag(tags, ' BOX ')).toBe(true);
    expect(matchesTag(tags, 'vhs')).toBe(false);
  });

  it('matches everything when the query is empty, and nothing untagged otherwise', () => {
    expect(matchesTag([], '')).toBe(true);
    expect(matchesTag([], '  ')).toBe(true);
    expect(matchesTag([], 'box')).toBe(false);
  });
});
