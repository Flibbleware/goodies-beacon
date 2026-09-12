import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './app-layout.js';

export const dashboardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  component: Dashboard,
});

/**
 * The empty state. P1-16 fills it in with today's matches, active items, source health and the
 * month's AI spend (§14).
 */
function Dashboard() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>

      <div className="mt-6 rounded-xl border border-dashed border-edge p-10 text-center dark:border-edge-dark">
        <p className="font-medium">Nothing is being watched yet.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim dark:text-ink-dim-dark">
          Once you can add a wanted item, this is where today's matches, source health and the
          month's AI spend will appear.
        </p>
      </div>
    </div>
  );
}
