import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { itemsQuery } from '../api/items.js';
import { appLayoutRoute } from './app-layout.js';

export const itemsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/items',
  loader: ({ context }) => context.queryClient.ensureQueryData(itemsQuery),
  component: Items,
});

/**
 * A plain index, and only that: P1-14 replaces it with §14's list — mode, last poll and the
 * candidate counts. What it has to do now is get you to the editor and back.
 */
function Items() {
  const { data, isPending, isError } = useQuery(itemsQuery);
  const items = data?.items ?? [];

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

      {isPending ? (
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load the wanted items.
        </p>
      ) : null}

      {data && items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-edge p-10 text-center dark:border-edge-dark">
          <p className="font-medium">No wanted items yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim dark:text-ink-dim-dark">
            Describe what you are hunting for as a spec and Goodies Beacon will start looking. The
            chat interview arrives in Phase 3; until then the spec is JSON you write yourself.
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-6 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
              <Link
                to="/items/$itemId/edit"
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
