import { Link } from '@tanstack/react-router';
import { Fragment, type ReactNode } from 'react';
import type { CategoryRow } from '../api/categories.js';
import { CategoryIcon } from './category-icon.js';

/** The pill a filter or sort option is drawn as, so the controls beside the chips match them. */
export const filterChip = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${
    active
      ? 'bg-paper-raised font-medium dark:bg-paper-raised-dark'
      : 'text-ink-dim hover:bg-paper-raised dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark'
  }`;

/** A category's id, `none` for the uncategorised, or undefined for everything. In the URL as is. */
export type CategoryChoice = string | undefined;

export const UNCATEGORISED = 'none';

/** What the URL asked for, if it still names something: a deleted category's link shows all. */
export function knownChoice(categories: readonly CategoryRow[], choice: unknown): CategoryChoice {
  if (choice === UNCATEGORISED) return UNCATEGORISED;
  return categories.some((category) => category.id === choice) ? (choice as string) : undefined;
}

export function inChoice(categoryId: string | null, choice: CategoryChoice): boolean {
  if (choice === undefined) return true;
  return choice === UNCATEGORISED ? categoryId === null : categoryId === choice;
}

export function choiceName(categories: readonly CategoryRow[], choice: CategoryChoice): string {
  if (choice === UNCATEGORISED) return 'Uncategorised';
  return categories.find((category) => category.id === choice)?.name ?? '';
}

/** Draws one chip as a link. The page supplies it, because its route and its other search differ. */
export type ChipLink = (chip: {
  category: CategoryChoice;
  active: boolean;
  className: string;
  children: ReactNode;
}) => ReactNode;

/**
 * All, then one chip per category with its icon and a count, then the uncategorised when there are
 * any (P1-19, P1-20, P1-22). Links rather than buttons, so a filtered view survives a reload and can
 * be bookmarked.
 */
export function CategoryFilter({
  categories,
  items,
  current,
  link,
}: {
  categories: readonly CategoryRow[];
  items: readonly { categoryId: string | null }[];
  current: CategoryChoice;
  link: ChipLink;
}) {
  const uncategorised = items.filter((item) => item.categoryId === null).length;

  return (
    <nav aria-label="Category" className="flex flex-wrap items-center gap-2">
      {link({
        category: undefined,
        active: current === undefined,
        className: filterChip(current === undefined),
        children: `All · ${items.length}`,
      })}
      {categories.map((category) => (
        <Fragment key={category.id}>
          {link({
            category: category.id,
            active: current === category.id,
            className: filterChip(current === category.id),
            children: (
              <>
                <CategoryIcon category={category} size="size-4" />
                {category.name} · {items.filter((item) => item.categoryId === category.id).length}
              </>
            ),
          })}
        </Fragment>
      ))}
      {uncategorised > 0 || current === UNCATEGORISED
        ? link({
            category: UNCATEGORISED,
            active: current === UNCATEGORISED,
            className: filterChip(current === UNCATEGORISED),
            children: `Uncategorised · ${uncategorised}`,
          })
        : null}
      {categories.length === 0 ? (
        <Link
          to="/settings/categories"
          className="text-xs text-ink-dim underline hover:text-ink dark:text-ink-dim-dark dark:hover:text-ink-dark"
        >
          Add categories in Settings
        </Link>
      ) : null}
    </nav>
  );
}

/** The category select in the wish and item forms: none, then each category A–Z. */
export function CategoryOptions({ categories }: { categories: readonly CategoryRow[] }) {
  return (
    <>
      <option value="">No category</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </>
  );
}
