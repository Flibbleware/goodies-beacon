import type { ItemCategory } from '@goodies-beacon/core/schemas';
import { CATEGORY_LABELS, ITEM_CATEGORIES } from '@goodies-beacon/core/schemas';
import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { type ItemRow, itemsQuery } from '../api/items.js';
import { CategoryFilter } from '../components/category-filter.js';
import { CategoryTile } from '../components/category-icon.js';
import { appLayoutRoute } from './app-layout.js';

export interface ItemsSearch {
  category?: ItemCategory | undefined;
}

export const itemsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/items',
  validateSearch: (search: Record<string, unknown>): ItemsSearch => ({
    category: (ITEM_CATEGORIES as readonly unknown[]).includes(search.category)
      ? (search.category as ItemCategory)
      : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(itemsQuery),
  component: Items,
});

/**
 * §14's list: status, mode, last poll and counts, newest change first — filterable by category
 * with the wish list's chips, and each item shown with its category tile (P1-20).
 */
function Items() {
  const { category } = itemsRoute.useSearch();
  const { data, isPending, isError } = useQuery(itemsQuery);
  const all = data?.items ?? [];
  const items = category ? all.filter((item) => item.category === category) : all;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Wanted items</h1>
        <Link
          to="/items/new"
          className="rounded-lg bg-beacon px-4 py-2 text-sm font-medium text-white"
        >
          New wanted item
        </Link>
      </div>

      {all.length > 0 ? (
        <div className="mt-6">
          <CategoryFilter
            items={all}
            current={category}
            link={({ category: chosen, active, className, children }) => (
              <Link
                to="/items"
                search={{ category: chosen }}
                aria-current={active ? 'true' : undefined}
                className={className}
              >
                {children}
              </Link>
            )}
          />
        </div>
      ) : null}

      {isPending ? (
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load the wanted items.
        </p>
      ) : null}

      {data && all.length > 0 && items.length === 0 && category ? (
        <div className="mt-4 rounded-xl border border-dashed border-edge p-8 text-center dark:border-edge-dark">
          <p className="text-sm text-ink-dim dark:text-ink-dim-dark">
            No wanted items in {CATEGORY_LABELS[category]}.
          </p>
        </div>
      ) : null}

      {data && all.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-edge p-10 text-center dark:border-edge-dark">
          <p className="font-medium">No wanted items yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim dark:text-ink-dim-dark">
            Describe what you are hunting for as a spec and Goodies Beacon will start looking. The
            chat interview arrives in Phase 3; until then you fill the spec in yourself.
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul
          aria-label="Wanted items"
          className="mt-4 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark"
        >
          {items.map((item) => (
            <li key={item.id} className="p-4">
              <Row item={item} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Row({ item }: { item: ItemRow }) {
  return (
    <div className="flex items-center gap-4">
      <CategoryTile category={item.category} />
      <div className="min-w-0 flex-1">
        <Details item={item} />
      </div>
    </div>
  );
}

function Details({ item }: { item: ItemRow }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          to="/items/$itemId"
          params={{ itemId: item.id }}
          className="text-sm font-medium hover:underline"
        >
          {item.title}
        </Link>
        <span className="rounded bg-paper-raised px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide dark:bg-paper-raised-dark">
          {item.status}
        </span>
        <span className="text-xs text-ink-dim dark:text-ink-dim-dark">
          {item.notificationMode === 'realtime' ? 'Real-time email' : 'Daily digest'}
          {item.currentVersion === null ? '' : ` · version ${item.currentVersion}`}
        </span>
      </div>

      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim dark:text-ink-dim-dark">
        <span className={item.failingPlans > 0 ? 'text-red-600 dark:text-red-400' : undefined}>
          {lastPoll(item)}
        </span>
        <span>
          {item.counts.candidates} candidate{item.counts.candidates === 1 ? '' : 's'}
        </span>
        <span>{item.counts.matched} matched</span>
        <span>{item.counts.uncertain} uncertain</span>
        {item.counts.pending > 0 ? <span>{item.counts.pending} waiting</span> : null}
      </p>
    </>
  );
}

/** "Failing since" rather than only "failed", which is the distinction §6 asks the UI to keep. */
function lastPoll(item: ItemRow): string {
  if (item.failingPlans > 0) {
    return item.lastSuccessAt
      ? `Failing since ${new Date(item.lastSuccessAt).toLocaleString()}`
      : 'Failing, and has never succeeded';
  }
  if (!item.lastPollAt) return 'Never polled';
  return `Last polled ${new Date(item.lastPollAt).toLocaleString()}`;
}
