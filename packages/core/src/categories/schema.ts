import { z } from 'zod';
import type { CategoryColour, CategoryIcon } from '../domain/constants.js';
import { CATEGORY_COLOURS, CATEGORY_ICONS } from '../domain/constants.js';

/**
 * The owner's categories (P1-22), made in Settings and shared by the wish list and the wanted
 * items. Nothing in the code names one: a wish or an item points at a row, or at none.
 */

export const categorySaveSchema = z.object({
  name: z.string().trim().min(1, 'a category needs a name').max(40, 'is too long'),
  icon: z.enum(CATEGORY_ICONS),
  colour: z.enum(CATEGORY_COLOURS),
});

export type CategorySaveInput = z.infer<typeof categorySaveSchema>;

/**
 * A category and how much uses it, so Settings can say what a delete would uncategorise.
 */
export interface Category {
  id: string;
  name: string;
  icon: CategoryIcon;
  colour: CategoryColour;
  wishes: number;
  items: number;
  createdAt: Date;
  updatedAt: Date;
}

/** For the wish and item forms: an id naming a category, or none. */
export const categoryIdSchema = z.uuid('names no category').nullable().default(null);
