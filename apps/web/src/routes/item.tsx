import type { WantedItemStatus } from '@goodies-beacon/core/schemas';
import {
  type ReadinessGap,
  readinessGaps,
  WANTED_ITEM_STATUSES,
  wantedSpecSchema,
} from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { CandidateSearch } from '../api/candidates.js';
import { categoriesQuery } from '../api/categories.js';
import { ApiError } from '../api/client.js';
import { itemQuery, itemsQuery, type LoadedItem, updateItem } from '../api/items.js';
import { DECISION_TILES } from '../candidates/bits.js';
import { CategoryIcon } from '../components/category-icon.js';
import { Alert, Button } from '../components/form.js';
import { HistoryIcon } from '../components/icons.js';
import { LastPoll } from '../components/last-poll.js';
import { Modal } from '../components/modal.js';
import { Pill } from '../components/pill.js';
import { DisplayImage } from '../items/display-image.js';
import {
  CriterionActions,
  EntryActions,
  type Removal,
  RemoveFromSpec,
} from '../items/entry-actions.js';
import { type ItemTab, type ItemTabId, ItemTabs, isItemTab } from '../items/item-tabs.js';
import { criterionName, planName } from '../items/labels.js';
import { PlanTable } from '../items/plan-table.js';
import { type EditTarget, SectionEditor } from '../items/section-editor.js';
import { CriteriaList, ReferenceList, SpecDescription, SpecSettings } from '../items/spec-card.js';
import { STATUS_LABELS } from '../items/status.js';
import { VersionList } from '../items/version-history.js';
import { appLayoutRoute } from './app-layout.js';

export interface ItemSearch {
  /** The open tab (P1-28); Details, the first, when absent. */
  tab?: Exclude<ItemTabId, 'details'> | undefined;
}

export const itemRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/items/$itemId',
  validateSearch: (search: Record<string, unknown>): ItemSearch => ({
    tab: isItemTab(search.tab) && search.tab !== 'details' ? search.tab : undefined,
  }),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(itemQuery(params.itemId)),
      context.queryClient.ensureQueryData(categoriesQuery),
    ]),
  component: ItemPage,
});

/**
 * Everything one wanted item is doing (§14): the spec as it stands, what each query has found,
 * the version history, and the one control that is not a spec change — the status (P1-28).
 *
 * Each section is a tab below the counts (P1-28), the open one kept in the URL. Where it is part of
 * the spec, its panel has a button opening an editor for that section alone (P1-24) — except
 * Criteria and Search Plans, whose button adds one and whose entries each have their own pencil and
 * bin (P1-27). Details also holds the title and category, and the JSON button edits the
 * whole document; the clock beside it opens the version history. An item is created from a dialog
 * on the list and lands here as a draft (P1-26): a red mark on a tab says what that section still
 * needs before the item can poll, and the status offers Active only once it can.
 */
function ItemPage() {
  const { itemId } = itemRoute.useParams();
  const { tab } = itemRoute.useSearch();
  const navigate = useNavigate({ from: '/items/$itemId' });
  const { data } = useQuery(itemQuery(itemId));
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [removing, setRemoving] = useState<Removal | null>(null);
  const [history, setHistory] = useState(false);

  if (!data) return null;
  const item = data.item;
  // Parsed here rather than on the server, because a spec written against an older schema must
  // still be *readable*: the page says so rather than rendering half a card, and offers no section
  // editors over a document they cannot draw.
  const parsed = item.current ? wantedSpecSchema.safeParse(item.current.document) : undefined;
  const spec = parsed?.success ? parsed.data : undefined;
  const gaps = spec ? readinessGaps(spec) : [];
  const flag = (section: ReadinessGap['section']) =>
    gaps
      .filter((gap) => gap.section === section)
      .map((gap) => gap.message)
      .join(' ') || undefined;
  // What keeps Active from being chosen: the gaps, or a stored spec the schema can no longer read at all.
  const blockers = spec
    ? gaps.map((gap) => gap.message)
    : ['Its spec no longer matches the schema; correct it in the JSON editor first.'];

  // Drawn from the plans' own records, so it stands even when the spec cannot be read.
  const searchPlans: ItemTab = {
    id: 'search-plans',
    flag: flag('searchPlans'),
    action: spec
      ? { kind: 'add', label: 'Add a Search Plan', onClick: () => setEditing('addSearchPlan') }
      : undefined,
    content: (
      <PlanTable
        plans={item.plans}
        actions={
          spec
            ? (row) => {
                const index = spec.searchPlans.findIndex((plan) => plan.id === row.planId);
                const plan = spec.searchPlans[index];
                if (!plan) return null;
                return (
                  <EntryActions
                    name={`the search plan ${plan.query} on ${plan.region}`}
                    onEdit={() => setEditing({ plan: index })}
                    onRemove={() =>
                      setRemoving({
                        title: 'Remove a Search Plan',
                        what: `“${plan.query}” on ${plan.region}`,
                        aside: 'What it has found stays, and so do its stats.',
                        spec: {
                          ...spec,
                          searchPlans: spec.searchPlans.filter((each) => each !== plan),
                        },
                        changeNote: `Removed the search plan ${planName(plan)}.`,
                      })
                    }
                  />
                );
              }
            : undefined
        }
      />
    ),
  };
  const tabs: ItemTab[] = spec
    ? [
        {
          id: 'details',
          action: { kind: 'edit', label: 'Edit Details', onClick: () => setEditing('describe') },
          content: <SpecDescription spec={spec} />,
        },
        searchPlans,
        {
          id: 'criteria',
          flag: flag('criteria'),
          action: {
            kind: 'add',
            label: 'Add a Criterion',
            onClick: () => setEditing('addCriterion'),
          },
          content: (
            <CriteriaList
              spec={spec}
              actions={(criterion, index) => (
                <CriterionActions
                  criterion={criterion}
                  onEdit={() => setEditing({ criterion: index })}
                  onRemove={() =>
                    setRemoving({
                      title: 'Remove a Criterion',
                      what: criterion.text,
                      aside: criterion.shared ? 'The shared criterion itself is kept.' : undefined,
                      spec: {
                        ...spec,
                        criteria: spec.criteria.filter((each) => each !== criterion),
                      },
                      changeNote: `Removed the criterion ${criterionName(criterion)}.`,
                    })
                  }
                />
              )}
            />
          ),
        },
        {
          id: 'settings',
          // Two groups, each edited on its own from a button beside its subtitle (P1-28).
          content: (
            <SpecSettings
              spec={spec}
              onEdit={(group) =>
                setEditing(group === 'marketplace' ? 'marketplaceSettings' : 'generalSettings')
              }
            />
          ),
        },
        {
          id: 'images',
          action: {
            kind: 'edit',
            label: 'Edit Reference Images',
            onClick: () => setEditing('images'),
          },
          content: (
            <>
              <ReferenceList images={spec.referenceImages} />
              <DisplayImage item={item} references={spec.referenceImages} />
            </>
          ),
        },
      ]
    : [searchPlans];

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/items" className="text-sm text-ink-dim hover:underline dark:text-ink-dim-dark">
        ← Wanted items
      </Link>

      <Header
        item={item}
        blockers={blockers}
        onJson={() => setEditing('json')}
        onHistory={() => setHistory(true)}
      />
      <Counts item={item} />

      {parsed && !parsed.success ? (
        <Alert tone="error">
          This spec no longer matches the schema, so its sections cannot be shown. Open the JSON to
          see and correct it.
        </Alert>
      ) : null}
      <ItemTabs
        tabs={tabs}
        selected={tabs.find((each) => each.id === (tab ?? 'details'))?.id ?? searchPlans.id}
        onSelect={(id, how) =>
          navigate({
            search: { tab: id === 'details' ? undefined : id },
            replace: how === 'keyboard',
            resetScroll: false,
          })
        }
      />

      <SectionEditor item={item} section={editing} onClose={() => setEditing(null)} />
      <RemoveFromSpec item={item} removal={removing} onClose={() => setRemoving(null)} />
      <Modal open={history} onClose={() => setHistory(false)} title="Version History">
        <VersionList versions={item.versions} currentId={item.current?.versionId} />
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="quiet" onClick={() => setHistory(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** The header's buttons are drawn like the count tiles below them. */
const HEADER_BUTTON =
  'rounded-xl border border-edge py-2 px-2.5 hover:bg-paper-raised dark:border-edge-dark dark:hover:bg-paper-raised-dark';

function Header({
  item,
  blockers,
  onJson,
  onHistory,
}: {
  item: LoadedItem;
  /** Why the item cannot start polling; empty when it can. */
  blockers: readonly string[];
  onJson: () => void;
  onHistory: () => void;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQuery).data?.categories ?? [];
  const category = categories.find((each) => each.id === item.categoryId);

  const change = useMutation({
    mutationFn: (status: WantedItemStatus) => updateItem(item.id, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: itemQuery(item.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
    },
  });

  // Held at the chosen value while it saves, rather than snapping back until the refetch lands.
  const status = change.isPending ? change.variables : item.status;
  const blocked = status !== 'active' && blockers.length > 0;
  const ids = { status: useId(), blockers: useId() };

  return (
    <>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{item.title}</h1>
            {/* Without its name beside it, as it has elsewhere, the icon carries the name itself. */}
            {category ? (
              <span role="img" aria-label={`Category: ${category.name}`} title={category.name}>
                <CategoryIcon category={category} />
              </span>
            ) : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Pill>{item.notificationMode === 'realtime' ? 'Real-time email' : 'Daily digest'}</Pill>
            {item.current ? <Pill>{`Version ${item.current.version}`}</Pill> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onHistory}
              aria-label="Version History"
              title="Version History"
              className={HEADER_BUTTON}
            >
              <HistoryIcon className="size-5" />
            </button>
            <button
              type="button"
              onClick={onJson}
              title="Edit the whole spec as JSON"
              className={`${HEADER_BUTTON} px-3 text-sm font-medium`}
            >
              JSON
            </button>
          </div>
          {/* Not a pill: when a plan is failing it is the warning. */}
          <p className="text-sm text-ink-dim dark:text-ink-dim-dark">
            <LastPoll poll={item} countPlans tipPosition="left-0 sm:left-auto sm:right-0" />
          </p>
        </div>
      </div>

      {change.isError ? (
        <Alert tone="error">
          {change.error instanceof ApiError ? change.error.message : 'Could not change the status.'}
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Saved as it is chosen, like the display image: a status is no spec version. */}
        <div className="flex items-center gap-2">
          <label htmlFor={ids.status} className="text-sm text-ink-dim dark:text-ink-dim-dark">
            Status
          </label>
          <select
            id={ids.status}
            value={status}
            onChange={(event) => change.mutate(event.target.value as WantedItemStatus)}
            disabled={change.isPending}
            aria-describedby={blocked ? ids.blockers : undefined}
            className="rounded-lg border border-edge bg-paper px-3 py-2 text-sm font-medium outline-none focus:border-beacon disabled:opacity-50 dark:border-edge-dark dark:bg-paper-dark"
          >
            {WANTED_ITEM_STATUSES.map((value) => (
              <option key={value} value={value} disabled={value === 'active' && blocked}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        {/* §6 gives this a rate limit and a summary email of its own; both are Phase 5. */}
        <span title="Arrives in Phase 5">
          <Button type="button" variant="quiet" disabled>
            Scan Current Listings
          </Button>
        </span>
      </div>

      {blocked ? (
        <div id={ids.blockers} className="mt-3 text-sm text-red-700 dark:text-red-400">
          <p className="font-medium">Before it can start polling:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/**
 * The counts, each one a link into the audit view filtered to what it counts (P1-15). A number
 * you cannot click through to is a number you have to take on trust, which is the opposite of
 * what requirement 6 asks of this page. The total is the exception: the audit view has no
 * "everything" filter, and the four before it add up to it and each links.
 */
function Counts({ item }: { item: LoadedItem }) {
  const { candidates, matched, uncertain, rejected, pending } = item.counts;

  const cells: [string, number, Exclude<CandidateSearch['decision'], 'all'>, string][] = [
    ['Matched', matched, 'match', 'Judged a match'],
    ['Uncertain', uncertain, 'uncertain', 'Something could not be established'],
    ['Rejected', rejected, 'reject', 'Filtered, discarded or judged against'],
    ['Waiting', pending, 'pending', 'Found but not yet judged'],
    ['Total', candidates, undefined, 'Every listing this item has been given'],
  ];

  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cells.map(([label, value, decision, hint]) => {
        const figure = (
          <>
            <dt className="text-xs opacity-80">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </>
        );
        return decision ? (
          <Link
            key={label}
            to="/candidates"
            search={{ item: item.id, decision, from: 'all' }}
            title={hint}
            className={`rounded-xl border p-3 ${DECISION_TILES[decision]}`}
          >
            {figure}
          </Link>
        ) : (
          <div key={label} title={hint} className={`rounded-xl border p-3 ${DECISION_TILES.total}`}>
            {figure}
          </div>
        );
      })}
    </dl>
  );
}
