import type { WantedItemStatus } from '@goodies-beacon/core/schemas';
import { type ReadinessGap, readinessGaps, wantedSpecSchema } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { CandidateSearch } from '../api/candidates.js';
import { ApiError } from '../api/client.js';
import { itemQuery, itemsQuery, type LoadedItem, updateItem } from '../api/items.js';
import { DECISION_TILES } from '../candidates/bits.js';
import { Alert, Button } from '../components/form.js';
import { HistoryIcon } from '../components/icons.js';
import { LastPoll } from '../components/last-poll.js';
import { Modal } from '../components/modal.js';
import { Pill } from '../components/pill.js';
import { DisplayImage } from '../items/display-image.js';
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
 * starts open; the rest is a click away. An item is created from a dialog on the list and lands
 * here as a draft (P1-26): a red mark beside a section says what it still needs before it can
 * poll, and Start Polling says the same until it can.
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
  const gaps = spec ? readinessGaps(spec) : [];
  const flag = (section: ReadinessGap['section']) =>
    gaps
      .filter((gap) => gap.section === section)
      .map((gap) => gap.message)
      .join(' ') || undefined;
  // What stops Start Polling: the gaps, or a stored spec the schema can no longer read at all.
  const blockers = spec
    ? gaps.map((gap) => gap.message)
    : ['Its spec no longer matches the schema; correct it in the JSON editor first.'];

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
      {spec ? (
        <ItemSection title="Details" defaultOpen onEdit={() => setEditing('describe')}>
          <SpecDescription spec={spec} />
        </ItemSection>
      ) : null}
      {/* Drawn from the plans' own records, so it stands even when the spec cannot be read. */}
      <ItemSection
        title="Search Plans"
        onEdit={spec ? () => setEditing('searchPlans') : undefined}
        flag={flag('searchPlans')}
      >
        <PlanTable plans={item.plans} />
      </ItemSection>
      {spec ? (
        <>
          <ItemSection
            title="Criteria"
            onEdit={() => setEditing('criteria')}
            flag={flag('criteria')}
          >
            <CriteriaList spec={spec} />
          </ItemSection>
          <ItemSection title="Settings" onEdit={() => setEditing('settings')}>
            <SpecSettings spec={spec} />
          </ItemSection>
          <ItemSection title="Reference Images" onEdit={() => setEditing('images')}>
            <ReferenceList images={spec.referenceImages} />
            <DisplayImage item={item} references={spec.referenceImages} />
          </ItemSection>
        </>
      ) : null}

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

  const change = useMutation({
    mutationFn: (status: WantedItemStatus) => updateItem(item.id, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: itemQuery(item.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
    },
  });

  // Draft and active are the two a new item moves between; the rest are set in Details.
  const next: WantedItemStatus = item.status === 'active' ? 'paused' : 'active';
  const blocked = next === 'active' && blockers.length > 0;
  const blockersId = useId();

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
        {/* Not a pill: when a plan is failing it is the warning. */}
        <span className="ml-1">
          <LastPoll poll={item} countPlans />
        </span>
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
          disabled={change.isPending || blocked}
          aria-describedby={blocked ? blockersId : undefined}
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

      {blocked ? (
        <div id={blockersId} className="mt-3 text-sm text-red-700 dark:text-red-400">
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
