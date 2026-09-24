import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, Outlet, redirect, useRouter } from '@tanstack/react-router';
import { useId } from 'react';
import { loadSession, logout } from '../api/auth.js';
import {
  CandidatesIcon,
  CostsIcon,
  DashboardIcon,
  GradingIcon,
  SettingsIcon,
  WantedIcon,
  WishIcon,
} from '../components/icons.js';
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
  { to: '/', label: 'Dashboard', Icon: DashboardIcon, soon: undefined },
  { to: '/items', label: 'Wanted items', Icon: WantedIcon, soon: undefined },
  { to: '/wishes', label: 'Wish list', Icon: WishIcon, soon: undefined },
  { to: '/candidates', label: 'Candidates', Icon: CandidatesIcon, soon: undefined },
  { to: '/scales', label: 'Grading scales', Icon: GradingIcon, soon: 'Phase 5' },
  { to: '/costs', label: 'Costs', Icon: CostsIcon, soon: 'Phase 5' },
] as const;

/** Beneath a Settings heading that is not itself a page (P1-23): most used first. */
const SETTINGS_NAV = [
  { to: '/settings/categories', label: 'Categories' },
  { to: '/settings/sources', label: 'Sources' },
  { to: '/settings/models', label: 'Models' },
  { to: '/settings/email', label: 'Email' },
  { to: '/settings/instance', label: 'Instance' },
  { to: '/settings/account', label: 'Account' },
] as const;

const ROW = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm';
const LINK = `${ROW} hover:bg-paper-raised dark:hover:bg-paper-raised-dark`;
const ACTIVE = `${ROW} font-medium bg-paper-raised dark:bg-paper-raised-dark`;
// Indented past the icon column, so a child's text lines up with its heading's.
const CHILD = 'block rounded-lg py-1.5 pr-3 pl-10 text-sm';

function AppLayout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const settingsId = useId();

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      // Anything cached was fetched as the signed-in user and is no longer ours to show.
      queryClient.clear();
      await router.navigate({ to: '/login' });
    },
  });

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <nav
        aria-label="Main"
        className="flex flex-col border-edge md:h-dvh md:border-r dark:border-edge-dark"
      >
        <div className="border-b border-edge px-5 py-4 dark:border-edge-dark">
          <span className="text-sm font-semibold tracking-tight">Goodies Beacon</span>
        </div>

        <ul className="flex-1 space-y-0.5 p-3">
          {NAV.map(({ to, label, Icon, soon }) => (
            <li key={to}>
              {soon ? (
                <span
                  title={`Arrives in ${soon}`}
                  aria-disabled="true"
                  className={`${ROW} text-ink-dim dark:text-ink-dim-dark`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{label}</span>
                  <span className="text-[0.625rem] uppercase tracking-wide opacity-70">{soon}</span>
                </span>
              ) : (
                <Link
                  to={to}
                  activeOptions={{ exact: to === '/' }}
                  className={LINK}
                  activeProps={{ className: ACTIVE }}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </Link>
              )}
            </li>
          ))}
          <li>
            <span id={settingsId} className={ROW}>
              <SettingsIcon className="size-4 shrink-0" />
              Settings
            </span>
            <ul aria-labelledby={settingsId} className="space-y-0.5">
              {SETTINGS_NAV.map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className={`${CHILD} font-light hover:bg-paper-raised dark:hover:bg-paper-raised-dark`}
                    activeProps={{
                      className: `${CHILD} bg-paper-raised dark:bg-paper-raised-dark`,
                    }}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
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
