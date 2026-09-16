import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import {
  type CandidateRowLike,
  type CandidateSearch,
  candidatesQuery,
  PAGE_SIZE,
} from '../api/candidates.js';
import { itemsQuery } from '../api/items.js';
import {
  DecisionChip,
  Provenance,
  price,
  REJECTION_REASONS,
  Thumbnail,
} from '../candidates/bits.js';
import { appLayoutRoute } from './app-layout.js';

export const candidatesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/candidates',
  validateSearch: (search: Record<string, unknown>): CandidateSearch => ({
    item: typeof search.item === 'string' && search.item !== '' ? search.item : undefined,
    decision: DECISIONS.includes(search.decision as string)
      ? (search.decision as CandidateSearch['decision'])
      : undefined,
    origin: ORIGINS.includes(search.origin as string)
      ? (search.origin as CandidateSearch['origin'])
      : undefined,
    offset: typeof search.offset === 'number' && search.offset > 0 ? search.offset : undefined,
  }),
  component: Candidates,
});

const DECISIONS = ['all', 'match', 'uncertain', 'reject', 'pending'];
const ORIGINS = ['all', 'poll', 'backfill', 'scan'];

const DECISION_LABELS: Record<string, string> = {
  all: 'Everything',
  match: 'Matches',
  uncertain: 'Uncertain',
  reject: 'Rejected',
  pending: 'Not yet judged',
};

const ORIGIN_LABELS: Record<string, string> = {
  all: 'Any origin',
  poll: 'From a poll',
  backfill: 'From the backfill',
  scan: 'From a scan',
};

/**
 * The audit view (requirement 6). Rejections are one chip away, not hidden behind a toggle that
 * defaults to off — "everything the reviewer rejected is visible so you can audit it" only holds
 * if browsing them is the same act as browsing the matches.
 */
function Candidates() {
  const search = candidatesRoute.useSearch();
  const { data, isPending, isError } = useQuery(candidatesQuery(search));
  const items = useQuery(itemsQuery);

  const rows = data?.candidates ?? [];
  const total = data?.total ?? 0;
  const offset = search.offset ?? 0;
  const item = items.data?.items.find((row) => row.id === search.item);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">
        {item ? `Candidates · ${item.title}` : 'Candidates'}
      </h1>

      <Filters search={search} />

      {isPending ? (
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load the candidates.
        </p>
      ) : null}

      {data && rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-edge p-10 text-center dark:border-edge-dark">
          <p className="font-medium">Nothing here yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim dark:text-ink-dim-dark">
            Candidates appear as polls find listings and the reviewer judges them. Rejections stay
            here too, with the evidence they were rejected on.
          </p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          <p className="mt-6 text-xs text-ink-dim dark:text-ink-dim-dark">
            {total <= rows.length
              ? `${total} candidate${total === 1 ? '' : 's'}`
              : `Showing ${offset + 1}–${offset + rows.length} of ${total}`}
          </p>

          <ul className="mt-2 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark">
            {rows.map((row) => (
              <li key={row.id} className="p-4">
                <Row row={row} showItem={search.item === undefined} />
              </li>
            ))}
          </ul>

          <Pages search={search} offset={offset} total={total} shown={rows.length} />
        </>
      ) : null}
    </div>
  );
}

function Filters({ search }: { search: CandidateSearch }) {
  return (
    <div className="mt-4 space-y-2">
      <Chips
        label="Verdict"
        values={DECISIONS}
        labels={DECISION_LABELS}
        current={search.decision ?? 'all'}
        to={(value) => ({
          ...search,
          decision: value as CandidateSearch['decision'],
          offset: undefined,
        })}
      />
      <Chips
        label="Origin"
        values={ORIGINS}
        labels={ORIGIN_LABELS}
        current={search.origin ?? 'all'}
        to={(value) => ({
          ...search,
          origin: value as CandidateSearch['origin'],
          offset: undefined,
        })}
      />
    </div>
  );
}

/** Links rather than buttons, so a filtered view can be bookmarked and linked to from the item. */
function Chips({
  label,
  values,
  labels,
  current,
  to,
}: {
  label: string;
  values: string[];
  labels: Record<string, string>;
  current: string;
  to: (value: string) => CandidateSearch;
}) {
  return (
    // A named landmark per group, so "Rejected" the filter is addressable apart from "Rejected"
    // the chip on a row that happens to be one.
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-dim dark:text-ink-dim-dark">{label}</span>
      {values.map((value) => (
        <Link
          key={value}
          to="/candidates"
          search={to(value)}
          aria-current={value === current ? 'true' : undefined}
          className={`rounded-lg px-2.5 py-1 text-xs ${
            value === current
              ? 'bg-paper-raised font-medium dark:bg-paper-raised-dark'
              : 'text-ink-dim hover:bg-paper-raised dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark'
          }`}
        >
          {labels[value]}
        </Link>
      ))}
    </nav>
  );
}

function Row({ row, showItem }: { row: CandidateRowLike; showItem: boolean }) {
  const title = row.listing.titleEn ?? row.listing.title;

  return (
    <Link
      to="/candidates/$candidateId"
      params={{ candidateId: row.id }}
      className="flex gap-3 sm:gap-4"
    >
      <Thumbnail mediaId={row.listing.images[0]} alt={title} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionChip decision={row.decision} />
          {row.retain ? (
            <span className="rounded border border-edge px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide dark:border-edge-dark">
              Retained
            </span>
          ) : null}
          {row.relistOf ? (
            <span className="text-[0.625rem] uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
              Seen before
            </span>
          ) : null}
          {showItem ? (
            <span className="text-xs text-ink-dim dark:text-ink-dim-dark">{row.itemTitle}</span>
          ) : null}
        </div>

        <p className="mt-1 text-sm font-medium">{title}</p>

        <p className="mt-0.5 text-xs text-ink-dim dark:text-ink-dim-dark">
          {price(row.listing)} · <Provenance listing={row.listing} />
        </p>

        {row.reason ? (
          <p className="mt-1 text-xs text-ink-dim dark:text-ink-dim-dark">
            Rejected before the reviewer: {REJECTION_REASONS[row.reason] ?? row.reason}
          </p>
        ) : row.englishSummary ? (
          <p className="mt-1 line-clamp-2 text-xs text-ink-dim dark:text-ink-dim-dark">
            {row.englishSummary}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

function Pages({
  search,
  offset,
  total,
  shown,
}: {
  search: CandidateSearch;
  offset: number;
  total: number;
  shown: number;
}) {
  const previous = offset > 0;
  const next = offset + shown < total;
  if (!previous && !next) return null;

  const style =
    'rounded-lg border border-edge px-3 py-1.5 text-sm dark:border-edge-dark hover:bg-paper-raised dark:hover:bg-paper-raised-dark';

  return (
    <nav className="mt-4 flex justify-between gap-3">
      {previous ? (
        <Link
          to="/candidates"
          search={{ ...search, offset: Math.max(0, offset - PAGE_SIZE) || undefined }}
          className={style}
        >
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to="/candidates" search={{ ...search, offset: offset + PAGE_SIZE }} className={style}>
          Older →
        </Link>
      ) : null}
    </nav>
  );
}
