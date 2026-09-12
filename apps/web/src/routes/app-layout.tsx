import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, Outlet, redirect, useRouter } from '@tanstack/react-router';
import { loadSession, logout } from '../api/auth.js';
import { rootRoute } from './root.js';

/**
 * Everything behind sign-in hangs off this route, so the guard is written once. `beforeLoad` runs
 * before any child loader, so an expired session redirects instead of flashing a page that then
 * fills with 401s.
 */
export const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const session = await loadSession(context.queryClient);
    if (!session.authenticated) throw redirect({ to: '/login' });
  },
  component: AppLayout,
});

/** The pages from §14. The ones without a route yet name the task that brings them. */
const NAV = [
  { to: '/', label: 'Dashboard', soon: undefined },
  { to: '/items', label: 'Wanted items', soon: 'P1-14' },
  { to: '/candidates', label: 'Candidates', soon: 'P1-15' },
  { to: '/scales', label: 'Grading scales', soon: 'Phase 5' },
  { to: '/costs', label: 'Costs', soon: 'P1-08' },
  { to: '/settings', label: 'Settings', soon: undefined },
] as const;

function AppLayout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      // Anything cached was fetched as the signed-in user and is no longer ours to show.
      queryClient.clear();
      await router.navigate({ to: '/login' });
    },
  });

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14rem_1fr]">
      <nav className="flex flex-col border-edge md:h-dvh md:border-r dark:border-edge-dark">
        <div className="border-b border-edge px-5 py-4 dark:border-edge-dark">
          <span className="text-sm font-semibold tracking-tight">Goodies Beacon</span>
        </div>

        <ul className="flex-1 space-y-0.5 p-3">
          {NAV.map(({ to, label, soon }) => (
            <li key={to}>
              {soon ? (
                <span
                  title={`Arrives in ${soon}`}
                  aria-disabled="true"
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-dim dark:text-ink-dim-dark"
                >
                  {label}
                  <span className="text-[0.625rem] uppercase tracking-wide opacity-70">{soon}</span>
                </span>
              ) : (
                <Link
                  to={to}
                  activeOptions={{ exact: to === '/' }}
                  className="block rounded-lg px-3 py-2 text-sm hover:bg-paper-raised dark:hover:bg-paper-raised-dark"
                  activeProps={{
                    className:
                      'block rounded-lg px-3 py-2 text-sm font-medium bg-paper-raised dark:bg-paper-raised-dark',
                  }}
                >
                  {label}
                </Link>
              )}
            </li>
          ))}
        </ul>

        <div className="border-t border-edge p-3 dark:border-edge-dark">
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-dim hover:bg-paper-raised disabled:opacity-50 dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="p-6 md:p-10">
        <Outlet />
      </main>
    </div>
  );
}
