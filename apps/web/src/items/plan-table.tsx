import type { PlanRow } from '../api/items.js';

/**
 * The search-plan table with per-query stats (§4).
 *
 * "Search broad, judge narrow" only works if you can see which of the broad queries is earning
 * its keep, which is what these five columns are for: how much a query found, how much of that
 * was expensive enough to look at, what came of it, and what the cheap stage cost meanwhile.
 */
export function PlanTable({ plans }: { plans: PlanRow[] }) {
  return plans.length === 0 ? (
    <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
      This spec has no search plans, so nothing is polled for it.
    </p>
  ) : (
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
          </tr>
        </thead>
        <tbody className="divide-y divide-edge dark:divide-edge-dark">
          {plans.map((plan) => (
            <tr key={plan.planId} className={plan.enabled ? '' : 'opacity-60'}>
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
              <td className="p-3 text-xs text-ink-dim dark:text-ink-dim-dark">
                {plan.lastRunAt ? new Date(plan.lastRunAt).toLocaleString() : 'never'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pre-filter calls cost hundredths of a cent, so two decimal places would read "$0.00" for
 * months and tell nobody anything. Under a cent it is shown in cents instead.
 */
function money(usd: string): string {
  const value = Number(usd);
  if (!Number.isFinite(value) || value === 0) return '—';
  if (value < 0.01) return `${(value * 100).toFixed(2)}¢`;
  return `$${value.toFixed(2)}`;
}
