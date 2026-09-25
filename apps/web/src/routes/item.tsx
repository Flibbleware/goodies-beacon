import type { WantedItemStatus } from '@goodies-beacon/core/schemas';
import { wantedSpecSchema } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { CandidateSearch } from '../api/candidates.js';
import { ApiError } from '../api/client.js';
import { itemQuery, itemsQuery, type LoadedItem, setItemStatus } from '../api/items.js';
import { DECISION_TILES } from '../candidates/bits.js';
import { Alert, Button } from '../components/form.js';
import { HistoryIcon } from '../components/icons.js';
import { Modal } from '../components/modal.js';
import { ItemSection } from '../items/item-section.js';
import { PlanTable } from '../items/plan-table.js';
import { type EditableSection, SectionEditor } from '../items/section-editor.js';
import { CriteriaList, ReferenceList, SpecDescription, SpecSettings } from '../items/spec-card.js';
import { VersionList } from '../items/version-history.js';
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
 *
 * Each section folds away and, where it is part of the spec, has a pencil opening an editor for
 * that section alone (P1-24): Details also holds the title, category and status, and the JSON
 * button edits the whole document; the clock beside it opens the version history. Only Details
 * starts open; the rest is a click away. The full editor page is kept for creating an item until
 * that flow is reworked.
 */
function ItemPage() {
  const { itemId } = itemRoute.useParams();
  const { data } = useQuery(itemQuery(itemId));
  const [editing, setEditing] = useState<EditableSection | null>(null);
  const [history, setHistory] = useState(false);

  if (!data) return null;
  const item = data.item;
  // Parsed here rather than on the server, because a spec written against an older schema must
  // still be *readable*: the page says so rather than rendering half a card, and offers no section
  // editors over a document they cannot draw.
  const parsed = item.current ? wantedSpecSchema.safeParse(item.current.document) : undefined;
  const spec = parsed?.success ? parsed.data : undefined;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/items" className="text-sm text-ink-dim hover:underline dark:text-ink-dim-dark">
        ← Wanted items
      </Link>

      <Header item={item} onJson={() => setEditing('json')} onHistory={() => setHistory(true)} />
      <Counts item={item} />

      {parsed && !parsed.success ? (
        <Alert tone="error">
          This spec no longer matches the schema, so its sections cannot be shown. Open the JSON to
          see and correct it.
        </Alert>
      ) : null}
      {spec ? (
        <>
          <ItemSection title="Details" defaultOpen onEdit={() => setEditing('describe')}>
            <SpecDescription spec={spec} />
          </ItemSection>
          <ItemSection title="Settings" onEdit={() => setEditing('settings')}>
            <SpecSettings spec={spec} />
          </ItemSection>
          <ItemSection title="Criteria" onEdit={() => setEditing('criteria')}>
            <CriteriaList spec={spec} />
          </ItemSection>
          <ItemSection title="Reference Images" onEdit={() => setEditing('images')}>
            <ReferenceList images={spec.referenceImages} />
          </ItemSection>
        </>
      ) : null}
      <ItemSection title="Search Plans" onEdit={spec ? () => setEditing('searchPlans') : undefined}>
        <PlanTable plans={item.plans} />
      </ItemSection>

      <SectionEditor item={item} section={editing} onClose={() => setEditing(null)} />
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
  onJson,
  onHistory,
}: {
  item: LoadedItem;
  onJson: () => void;
  onHistory: () => void;
}) {
  const queryClient = useQueryClient();

  const change = useMutation({
    mutationFn: (status: WantedItemStatus) => setItemStatus(item.id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: itemQuery(item.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
    },
  });

  // Draft and active are the two a new item moves between; the rest are set in Details.
  const next: WantedItemStatus = item.status === 'active' ? 'paused' : 'active';

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{item.title}</h1>
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
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-dim dark:text-ink-dim-dark">
        <Pill>{item.status}</Pill>
        <Pill>{item.notificationMode === 'realtime' ? 'Real-time email' : 'Daily digest'}</Pill>
        {item.current ? <Pill>{`Version ${item.current.version}`}</Pill> : null}
        {/* Not a pill: it can be a sentence, and when a plan is failing it is the warning. */}
        <span className="ml-1">{lastPoll(item)}</span>
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
          {next === 'active' ? 'Start Polling' : 'Pause Polling'}
        </Button>

        {/* §6 gives this a rate limit and a summary email of its own; both are Phase 5. */}
        <span title="Arrives in Phase 5">
          <Button type="button" variant="quiet" disabled>
            Scan Current Listings
          </Button>
        </span>
      </div>
    </>
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span className="rounded bg-paper-raised px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide dark:bg-paper-raised-dark">
      {children}
    </span>
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
            search={{ item: item.id, decision }}
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
