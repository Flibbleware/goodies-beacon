import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import {
  type Budget,
  type Dashboard,
  dashboardQuery,
  type SourceRow,
  type WorkerRow,
} from '../api/dashboard.js';
import { appLayoutRoute } from './app-layout.js';

export const dashboardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery),
  component: DashboardPage,
});

/**
 * The page a session lands on (§14): what happened today, what is being watched, whether the
 * marketplaces are answering, what the month has cost, and whether the workers are alive.
 *
 * **Every figure is a link to the page that explains it**, which is P1-16's acceptance line and
 * the reason the panels are built from `Link`s rather than from `div`s. A number you cannot click
 * through to is a number you have to take on trust, and the whole design is the opposite of that.
 */
function DashboardPage() {
  const { data, isPending, isError } = useQuery(dashboardQuery);

  if (isPending) {
    return (
      <Page>
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      </Page>
    );
  }

  if (isError || !data) {
    return (
      <Page>
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load the dashboard.
        </p>
      </Page>
    );
  }

  const dashboard = data.dashboard;

  if (dashboard.items.total === 0)
    return (
      <Page>
        <Empty />
      </Page>
    );

  return (
    <Page>
      <Today dashboard={dashboard} />
      <Items counts={dashboard.items} />
      <Sources sources={dashboard.sources} />
      <Spend budget={dashboard.budget} />
      <Workers workers={dashboard.workers} />
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      {children}
    </div>
  );
}

function Empty() {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-edge p-10 text-center dark:border-edge-dark">
      <p className="font-medium">Nothing is being watched yet.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim dark:text-ink-dim-dark">
        Add a wanted item and this is where today's matches, source health and the month's AI spend
        will appear.
      </p>
      <Link
        to="/items/new"
        className="mt-6 inline-block rounded-lg bg-beacon px-4 py-2 text-sm font-medium text-white"
      >
        New wanted item
      </Link>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="font-medium">
          {title}
        </h2>
        {note ? <span className="text-xs text-ink-dim dark:text-ink-dim-dark">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A figure and the page it came from. Nothing on this dashboard is a figure without one, so the
 * caller supplies the link and this supplies only what goes inside it — which keeps the router's
 * own typing of paths and search parameters, rather than widening it to get one component.
 */
const FIGURE =
  'rounded-xl border border-edge p-3 hover:bg-paper-raised dark:border-edge-dark dark:hover:bg-paper-raised-dark';

function Figure({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' }) {
  return (
    <>
      <span className="block text-xs text-ink-dim dark:text-ink-dim-dark">{label}</span>
      <span
        className={`mt-1 block text-lg font-semibold tabular-nums ${
          tone === 'warn' ? 'text-amber-700 dark:text-amber-500' : ''
        }`}
      >
        {value}
      </span>
    </>
  );
}

function Today({ dashboard }: { dashboard: Dashboard }) {
  const { matched, uncertain, rejected, waiting } = dashboard.today;

  return (
    <Panel title="Today" note={`since midnight, ${dashboard.timezone}`}>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link to="/candidates" search={{ decision: 'match' }} className={FIGURE}>
          <Figure label="Matched" value={matched} />
        </Link>
        <Link to="/candidates" search={{ decision: 'uncertain' }} className={FIGURE}>
          <Figure label="Uncertain" value={uncertain} />
        </Link>
        <Link to="/candidates" search={{ decision: 'reject' }} className={FIGURE}>
          <Figure label="Rejected" value={rejected} />
        </Link>
        <Link to="/candidates" search={{ decision: 'pending' }} className={FIGURE}>
          <Figure label="Waiting" value={waiting} />
        </Link>
      </div>
    </Panel>
  );
}

function Items({ counts }: { counts: Dashboard['items'] }) {
  return (
    <Panel title="Wanted items">
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link to="/items" className={FIGURE}>
          <Figure label="Active" value={counts.active} />
        </Link>
        <Link to="/items" className={FIGURE}>
          <Figure label="Paused" value={counts.paused} />
        </Link>
        <Link to="/items" className={FIGURE}>
          <Figure label="Draft" value={counts.draft} />
        </Link>
        <Link to="/items" className={FIGURE}>
          <Figure label="All" value={counts.total} />
        </Link>
      </div>
    </Panel>
  );
}

/**
 * P1-16's other acceptance line: an adapter failure from the last poll is visible without opening
 * a log. So the error text is on the page, in red, with the date it was last working beside it —
 * "failing since Tuesday" rather than "failed" — and it links at the item that can act on it.
 */
function Sources({ sources }: { sources: SourceRow[] }) {
  if (sources.length === 0) {
    return (
      <Panel title="Sources">
        <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
          No active item has a search plan, so nothing is being polled.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Sources">
      <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark">
        {sources.map((source) => (
          <li key={source.source} className="p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{source.source}</span>
              <span className="text-xs text-ink-dim dark:text-ink-dim-dark">
                {source.activePlans === 0
                  ? 'no active plans'
                  : `${source.activePlans} active plan${source.activePlans === 1 ? '' : 's'}`}
                {' · '}
                {source.lastRunAt
                  ? `last polled ${new Date(source.lastRunAt).toLocaleString()}`
                  : 'never polled'}
              </span>
            </div>

            {source.lastError ? (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                {source.lastSuccessAt
                  ? `Failing since ${new Date(source.lastSuccessAt).toLocaleString()}`
                  : 'Failing, and has never succeeded'}
                {source.failingPlans > 1 ? ` (${source.failingPlans} plans)` : ''}:{' '}
                {source.lastError}
                {source.failingItemId ? (
                  <>
                    {' '}
                    <Link
                      to="/items/$itemId"
                      params={{ itemId: source.failingItemId }}
                      className="underline"
                    >
                      {source.failingItemTitle}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Spend({ budget }: { budget: Budget | null }) {
  if (!budget) {
    return (
      <Panel title="AI spend">
        <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
          The month's spend could not be read.
        </p>
      </Panel>
    );
  }

  const spent = budget.spentGbp === null ? null : `£${budget.spentGbp.toFixed(2)}`;
  const cap = budget.capGbp === null ? null : `£${budget.capGbp.toFixed(2)}`;
  const share =
    budget.spentGbp !== null && budget.capGbp
      ? Math.min(100, Math.round((budget.spentGbp / budget.capGbp) * 100))
      : null;

  return (
    <Panel title="AI spend" note="this calendar month">
      <Link
        to="/settings/models"
        className="mt-3 block rounded-xl border border-edge p-4 hover:bg-paper-raised dark:border-edge-dark dark:hover:bg-paper-raised-dark"
      >
        <span className="text-lg font-semibold tabular-nums">{spent ?? 'not known'}</span>
        <span className="ml-2 text-sm text-ink-dim dark:text-ink-dim-dark">
          {cap ? `of ${cap}` : 'no cap set'}
        </span>

        {share === null ? null : (
          <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-paper-raised dark:bg-paper-raised-dark">
            <span
              className={`block h-full ${budget.ok ? 'bg-beacon' : 'bg-amber-500'}`}
              style={{ width: `${share}%` }}
            />
          </span>
        )}

        <span className="mt-2 block text-xs text-ink-dim dark:text-ink-dim-dark">
          {budget.ok
            ? 'Reviews are running. The cap is set in Settings.'
            : `Reviews are paused until ${new Date(budget.resetsAt).toLocaleDateString()}, or until the cap is raised in Settings.`}
        </span>
      </Link>
    </Panel>
  );
}

/**
 * No link: a stale heartbeat is answered in a terminal, not on another page. The note says where,
 * which is more use than a link that goes nowhere useful.
 */
function Workers({ workers }: { workers: WorkerRow[] }) {
  return (
    <Panel title="Processes">
      {workers.length === 0 ? (
        <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
          Nothing has reported in yet. A heartbeat is recorded every five minutes.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-3">
          {workers.map((worker) => (
            <li
              key={worker.role}
              className="rounded-xl border border-edge px-3 py-2 text-sm dark:border-edge-dark"
            >
              <span className="font-medium">{worker.role}</span>{' '}
              <span
                className={
                  worker.stale
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-ink-dim dark:text-ink-dim-dark'
                }
              >
                {worker.stale ? 'not responding since' : 'last seen'}{' '}
                {new Date(worker.lastSeenAt).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
