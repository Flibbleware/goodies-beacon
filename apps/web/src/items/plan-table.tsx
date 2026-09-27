import { type ReactNode, useState } from 'react';
import type { PlanRow } from '../api/items.js';

/**
 * The search-plan table with per-query stats (§4).
 *
 * "Search broad, judge narrow" only works if you can see which of the broad queries is earning
 * its keep, which is what these five columns are for: how much a query found, how much of that
 * was expensive enough to look at, what came of it, and what the cheap stage cost meanwhile.
 *
 * Plans the spec has dropped keep their rows for their stats, but are hidden until asked for:
 * every region change makes one (P1-29), and a table of old plans buries the ones polling now.
 */
export function PlanTable({
  plans,
  actions,
}: {
  plans: PlanRow[];
  /** A plan's own edit and remove (P1-27); a plan the spec has since dropped has none. */
  actions?: ((plan: PlanRow) => ReactNode) | undefined;
}) {
  const [showRemoved, setShowRemoved] = useState(false);
  const removed = plans.filter((plan) => !plan.inSpec).length;
  const shown = showRemoved ? plans : plans.filter((plan) => plan.inSpec);

  return (
    <>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
          This spec has no search plans, so nothing is polled for it.
        </p>
      ) : (
        <Table plans={shown} actions={actions} />
      )}
      {removed > 0 ? (
        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-ink-dim dark:text-ink-dim-dark">
          <input
            type="checkbox"
            checked={showRemoved}
            onChange={(event) => setShowRemoved(event.target.checked)}
            className="size-4 rounded border-edge dark:border-edge-dark"
          />
          Show removed plans ({removed})
        </label>
      ) : null}
    </>
  );
}

function Table({
  plans,
  actions,
}: {
  plans: PlanRow[];
  actions: ((plan: PlanRow) => ReactNode) | undefined;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-edge dark:border-edge-dark">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
          <tr className="border-b border-edge dark:border-edge-dark">
            <th className="p-3 text-left font-medium">Query</th>
            <th className="p-3 text-right font-medium">Found</th>
            <th className="p-3 text-right font-medium">Reviewed</th>
            <th className="p-3 text-right font-medium">Matched</th>
            <th className="p-3 text-right font-medium">Uncertain</th>
            <th className="p-3 text-right font-medium">Pre-filter</th>
            <th className="p-3 text-left font-medium">Last run</th>
            {actions ? (
              <th className="p-3">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-edge dark:divide-edge-dark">
          {plans.map((plan) => (
            // Top-aligned, so the figures and buttons read along the query's line however tall a
            // failing plan's message makes the row.
            <tr key={plan.planId} className={`align-top ${plan.enabled ? '' : 'opacity-60'}`}>
              <td className="p-3">
                <span className="font-medium">{plan.query || plan.planId}</span>
                <span className="block text-xs text-ink-dim dark:text-ink-dim-dark">
                  {plan.inSpec
                    ? `${plan.source} · ${plan.region}${plan.enabled ? '' : ' · paused'}`
                    : 'removed from the spec; its stats are kept'}
                </span>
                {plan.lastError ? (
                  <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                    {plan.lastSuccessAt
                      ? `Failing since ${new Date(plan.lastSuccessAt).toLocaleString()}: `
                      : 'Has never succeeded: '}
                    {plan.lastError}
                  </span>
                ) : null}
                {plan.backlogUntil ? (
                  <span className="mt-1 block text-xs text-ink-dim dark:text-ink-dim-dark">
                    Still draining a window an earlier capped run skipped.
                  </span>
                ) : null}
              </td>
              <td className="p-3 text-right tabular-nums">{plan.candidatesFound}</td>
              <td className="p-3 text-right tabular-nums">{plan.candidatesReviewed}</td>
              <td className="p-3 text-right tabular-nums">{plan.candidatesMatched}</td>
              <td className="p-3 text-right tabular-nums">{plan.candidatesUncertain}</td>
              <td className="p-3 text-right tabular-nums">{money(plan.prefilterCostUsd)}</td>
              <td className="p-3 text-xs leading-5 text-ink-dim dark:text-ink-dim-dark">
                {plan.lastRunAt ? new Date(plan.lastRunAt).toLocaleString() : 'never'}
              </td>
              {actions ? (
                <td className="px-2 py-2.5">
                  {plan.inSpec ? <div className="flex gap-1">{actions(plan)}</div> : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pre-filter calls cost hundredths of a cent, so two decimal places would read "$0.00" for
 * months and say nothing was spent. Anything under a cent is shown as a cent instead, so the column
 * stays in dollars rather than switching to cents for the cheap plans (stored exactly, as ever).
 */
function money(usd: string): string {
  const value = Number(usd);
  if (!Number.isFinite(value) || value === 0) return '—';
  return `$${Math.max(value, 0.01).toFixed(2)}`;
}
