import { useQuery } from '@tanstack/react-query';
import { createRoute, redirect } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { type SettingsResponse, settingsQuery } from '../api/settings.js';
import { AccountSection } from '../settings/account-section.js';
import { AiSection } from '../settings/ai-section.js';
import { CategoriesSection } from '../settings/categories-section.js';
import { EmailSection } from '../settings/email-section.js';
import { InstanceSection } from '../settings/instance-section.js';
import { SourcesSection } from '../settings/sources-section.js';
import { appLayoutRoute } from './app-layout.js';

/** One page per section since P1-23 (§14); the sidebar lists them under a Settings heading. */
export const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings',
});

/** `/settings` was a single page until P1-23, so a bookmark to it lands on the first of them. */
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/categories', replace: true });
  },
});

const categoriesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'categories',
  component: CategoriesSection,
});

const sourcesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'sources',
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: () => (
    <WithSettings title="Sources">
      {(data) => <SourcesSection ebay={data.settings.sources.ebay} />}
    </WithSettings>
  ),
});

const modelsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'models',
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: () => (
    <WithSettings title="Models">{(data) => <AiSection ai={data.settings.ai} />}</WithSettings>
  ),
});

const emailRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'email',
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: () => (
    <WithSettings title="Email">
      {(data) => <EmailSection email={data.settings.email} />}
    </WithSettings>
  ),
});

const instanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'instance',
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: () => (
    <WithSettings title="Instance">
      {(data) => <InstanceSection instance={data.settings.instance} host={data.instanceHost} />}
    </WithSettings>
  ),
});

const accountRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'account',
  component: AccountSection,
});

export const settingsRouteTree = settingsRoute.addChildren([
  settingsIndexRoute,
  categoriesRoute,
  sourcesRoute,
  modelsRoute,
  emailRoute,
  instanceRoute,
  accountRoute,
]);

function WithSettings({
  title,
  children,
}: {
  title: string;
  children: (data: SettingsResponse) => ReactNode;
}) {
  const { data, isPending, isError } = useQuery(settingsQuery);

  if (data) return children(data);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {isPending ? (
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load settings.
        </p>
      ) : null}
    </div>
  );
}
