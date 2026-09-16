import type { WantedItemStatus } from '@goodies-beacon/core/schemas';
import { wantedSpecSchema } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { ApiError } from '../api/client.js';
import { itemQuery, itemsQuery, type LoadedItem, setItemStatus } from '../api/items.js';
import { Alert, Button } from '../components/form.js';
import { PlanTable } from '../items/plan-table.js';
import { SpecCard } from '../items/spec-card.js';
import { VersionHistory } from '../items/version-history.js';
import { appLayoutRoute } from './app-layout.js';

export const itemRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/items/$itemId',
  loader: ({ context, params }) => context.queryClient.ensureQueryData(itemQuery(params.itemId)),
  component: ItemPage,
});

/**
 * Everything one wanted item is doing (§14): the spec as it stands, what each query has found,
 * the version history, and the one control that is not a spec change — pause and resume.
 */
function ItemPage() {
  const { itemId } = itemRoute.useParams();
  const { data } = useQuery(itemQuery(itemId));

  if (!data) return null;
  const item = data.item;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/items" className="text-sm text-ink-dim hover:underline dark:text-ink-dim-dark">
        ← Wanted items
      </Link>

      <Header item={item} />
      <Counts item={item} />

      {item.current ? <Spec document={item.current.document} /> : null}
      <PlanTable plans={item.plans} />
      <VersionHistory versions={item.versions} currentId={item.current?.versionId} />
    </div>
  );
}

function Header({ item }: { item: LoadedItem }) {
  const queryClient = useQueryClient();

  const change = useMutation({
    mutationFn: (status: WantedItemStatus) => setItemStatus(item.id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: itemQuery(item.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
    },
  });

  // Draft and active are the two a new item moves between; the rest are set from the editor.
  const next: WantedItemStatus = item.status === 'active' ? 'paused' : 'active';

  return (
    <>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{item.title}</h1>
        <Link
          to="/items/$itemId/edit"
          params={{ itemId: item.id }}
          className="text-sm text-ink-dim hover:underline dark:text-ink-dim-dark"
        >
          Edit the spec
        </Link>
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-dim dark:text-ink-dim-dark">
        <span className="rounded bg-paper-raised px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide dark:bg-paper-raised-dark">
          {item.status}
        </span>
        <span>
          {item.notificationMode === 'realtime' ? 'Real-time email' : 'Daily digest'}
          {item.current ? ` · version ${item.current.version}` : ''}
        </span>
        <span>{lastPoll(item)}</span>
      </p>

      {change.isError ? (
        <Alert tone="error">
          {change.error instanceof ApiError ? change.error.message : 'Could not change the status.'}
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={next === 'active' ? 'primary' : 'quiet'}
          onClick={() => change.mutate(next)}
          disabled={change.isPending}
        >
          {next === 'active' ? 'Start polling' : 'Pause polling'}
        </Button>

        {/* §6 gives this a rate limit and a summary email of its own; both are Phase 5. */}
        <span title="Arrives in Phase 5">
          <Button type="button" variant="quiet" disabled>
            Scan current listings
          </Button>
        </span>
      </div>
    </>
  );
}

/**
 * The item's own last poll, said in the terms §6 uses: a plan that is failing now but worked
 * before is "failing since", not simply "failed", because the difference is what you act on.
 */
function lastPoll(item: LoadedItem): string {
  if (item.failingPlans > 0) {
    const plural = item.failingPlans === 1 ? 'plan is' : 'plans are';
    return item.lastSuccessAt
      ? `${item.failingPlans} ${plural} failing since ${new Date(item.lastSuccessAt).toLocaleString()}`
      : `${item.failingPlans} ${plural} failing and none has ever succeeded`;
  }
  if (!item.lastPollAt) return 'Never polled';
  return `Last polled ${new Date(item.lastPollAt).toLocaleString()}`;
}

function Counts({ item }: { item: LoadedItem }) {
  const { candidates, matched, uncertain, rejected, pending } = item.counts;

  const cells: [string, number, string][] = [
    ['Candidates', candidates, 'Listings this item has been given'],
    ['Matched', matched, 'Judged a match'],
    ['Uncertain', uncertain, 'Something could not be established'],
    ['Rejected', rejected, 'Filtered, discarded or judged against'],
    ['Waiting', pending, 'Found but not yet judged'],
  ];

  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cells.map(([label, value, hint]) => (
        <div
          key={label}
          title={hint}
          className="rounded-xl border border-edge p-3 dark:border-edge-dark"
        >
          <dt className="text-xs text-ink-dim dark:text-ink-dim-dark">{label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The stored document is parsed here rather than on the server, because a spec written against an
 * older schema must still be *readable* — the page says so and links to the editor instead of
 * rendering half a card.
 */
function Spec({ document }: { document: Record<string, unknown> }) {
  const parsed = wantedSpecSchema.safeParse(document);

  if (!parsed.success) {
    return (
      <Alert tone="error">
        This spec no longer matches the schema, so it cannot be shown as a card. Open the editor to
        see and correct the JSON.
      </Alert>
    );
  }

  return <SpecCard spec={parsed.data} />;
}
