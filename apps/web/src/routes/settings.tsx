import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { settingsQuery } from '../api/settings.js';
import { AccountSection } from '../settings/account-section.js';
import { EmailSection } from '../settings/email-section.js';
import { InstanceSection } from '../settings/instance-section.js';
import { appLayoutRoute } from './app-layout.js';

export const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings',
  component: SettingsPage,
});

/** Account, email and instance, in the order §P0-10 lists them. Later sections add themselves. */
function SettingsPage() {
  const { data, isPending, isError } = useQuery(settingsQuery);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      {isPending ? (
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load settings.
        </p>
      ) : null}

      {data ? (
        <>
          <AccountSection />
          <EmailSection email={data.settings.email} />
          <InstanceSection instance={data.settings.instance} host={data.instanceHost} />
        </>
      ) : null}
    </div>
  );
}
