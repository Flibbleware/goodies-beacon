import { z } from 'zod';

/**
 * Free-text tags (P1-21): the owner's own words for sorting a collection, beside the fixed
 * categories. On wishes today; kept apart from them so a wanted item can take the same field.
 */

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/**
 * Trimmed, empties dropped, and a repeat that differs only in case dropped in favour of the first
 * spelling. Commas are refused because the form edits tags as one comma-separated field, so a tag
 * holding one would come back as two.
 */
export const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .max(MAX_TAG_LENGTH, `a tag is at most ${MAX_TAG_LENGTH} characters`)
      .refine((tag) => !tag.includes(','), 'a tag cannot contain a comma'),
  )
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (tag === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })
  .pipe(z.array(z.string()).max(MAX_TAGS, `at most ${MAX_TAGS} tags`));

/** The form's one text field, split. The schema does the trimming and tidying. */
export const splitTags = (text: string): string[] => text.split(',');

export const joinTags = (tags: readonly string[]): string => tags.join(', ');

/** True when any tag contains the query, ignoring case; an empty query matches everything. */
export function matchesTag(tags: readonly string[], query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return needle === '' || tags.some((tag) => tag.toLocaleLowerCase().includes(needle));
}
