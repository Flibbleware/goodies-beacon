import type { ItemCategory } from '@goodies-beacon/core/schemas';
import { CATEGORY_LABELS, ITEM_CATEGORIES } from '@goodies-beacon/core/schemas';
import { Fragment, type ReactNode } from 'react';
import { CategoryIcon } from './category-icon.js';

/** The pill a filter or sort option is drawn as, so the controls beside the chips match them. */
export const filterChip = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${
    active
      ? 'bg-paper-raised font-medium dark:bg-paper-raised-dark'
      : 'text-ink-dim hover:bg-paper-raised dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark'
  }`;

/** Draws one chip as a link. The page supplies it, because its route and its other search differ. */
export type ChipLink = (chip: {
  category: ItemCategory | undefined;
  active: boolean;
  className: string;
  children: ReactNode;
}) => ReactNode;

/**
 * All, then one chip per category with its icon and a count (P1-19, P1-20). Links rather than
 * buttons, so a filtered view survives a reload and can be bookmarked.
 */
export function CategoryFilter({
  items,
  current,
  link,
}: {
  items: readonly { category: ItemCategory }[];
  current: ItemCategory | undefined;
  link: ChipLink;
}) {
  return (
    <nav aria-label="Category" className="flex flex-wrap items-center gap-2">
      {link({
        category: undefined,
        active: current === undefined,
        className: filterChip(current === undefined),
        children: `All · ${items.length}`,
      })}
      {ITEM_CATEGORIES.map((category) => (
        <Fragment key={category}>
          {link({
            category,
            active: current === category,
            className: filterChip(current === category),
            children: (
              <>
                <CategoryIcon category={category} size="size-4" />
                {CATEGORY_LABELS[category]} ·{' '}
                {items.filter((item) => item.category === category).length}
              </>
            ),
          })}
        </Fragment>
      ))}
    </nav>
  );
}
