/** How the wish list is ordered (P1-19). A–Z is the default and is left out of the URL. */
export type WishSort = 'az' | 'newest';

interface Sortable {
  id: string;
  label: string;
  createdAt: string;
}

// Case-insensitive, and numbers compared as numbers, so "Vol. 2" comes before "Vol. 10".
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const newestFirst = (a: Sortable, b: Sortable) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** A sorted copy. Newest is by when a wish was added, not edited, so a row does not jump. */
export function sortWishes<T extends Sortable>(wishes: readonly T[], sort: WishSort): T[] {
  return [...wishes].sort(
    sort === 'az' ? (a, b) => collator.compare(a.label, b.label) || newestFirst(a, b) : newestFirst,
  );
}
