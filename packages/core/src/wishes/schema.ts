import { z } from 'zod';
import { categoryIdSchema } from '../categories/schema.js';
import { tagsSchema } from '../domain/tags.js';

/**
 * The wish list (P1-19): a label, a category, and optionally a link to search by hand and some
 * tags (P1-21).
 *
 * Shared by the API and the page, so the form refuses what the server would refuse.
 */

/**
 * http and https only. The link is rendered as an `href` the owner clicks, and `javascript:` or
 * `data:` there would run in the app's own origin; an empty field is "no link", not an error.
 */
const searchUrlSchema = z
  .string()
  .trim()
  .max(2000, 'is too long')
  .transform((value) => (value === '' ? null : value))
  .pipe(z.url({ protocol: /^https?$/, error: 'must be an http or https link' }).nullable());

export const wishSaveSchema = z.object({
  // The same limit as a wanted item's title, so promoting a wish can never fail on its label.
  label: z.string().trim().min(1, 'a wish needs a label').max(200, 'is too long'),
  categoryId: categoryIdSchema,
  searchUrl: searchUrlSchema.nullable().default(null),
  tags: tagsSchema.default([]),
});

export type WishSaveInput = z.infer<typeof wishSaveSchema>;

export interface Wish {
  id: string;
  label: string;
  categoryId: string | null;
  searchUrl: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
