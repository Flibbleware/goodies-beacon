import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError } from '../api/client.js';
import { type InstanceSettings, saveSettings, settingsQuery } from '../api/settings.js';
import { appLayoutRoute } from './app-layout.js';

export const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings',
  component: SettingsPage,
});

/** P0-10 adds the account and email sections below this one. */
function SettingsPage() {
  const { data, isPending, isError } = useQuery(settingsQuery);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      {isPending ? <p className="mt-6 text-sm text-ink-dim">Loading…</p> : null}
      {isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load settings.
        </p>
      ) : null}

      {data ? <InstanceSection instance={data.settings.instance} host={data.instanceHost} /> : null}
    </div>
  );
}

function InstanceSection({ instance, host }: { instance: InstanceSettings; host: string }) {
  const queryClient = useQueryClient();
  const timezoneId = useId();
  const digestId = useId();
  const [form, setForm] = useState(instance);

  // A save from elsewhere, or a refetch, should win over an untouched form.
  useEffect(() => setForm(instance), [instance]);

  const save = useMutation({
    mutationFn: () => saveSettings({ instance: form }),
    onSuccess: (saved) => queryClient.setQueryData(settingsQuery.queryKey, saved),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const unchanged = form.timezone === instance.timezone && form.digestTime === instance.digestTime;

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 rounded-xl border border-edge bg-paper-raised p-6 dark:border-edge-dark dark:bg-paper-raised-dark"
    >
      <h2 className="font-medium">Instance</h2>

      <dl className="mt-4 flex items-baseline gap-3 text-sm">
        <dt className="text-ink-dim dark:text-ink-dim-dark">Address</dt>
        <dd>
          <code>{host}</code>
          <span className="ml-2 text-xs text-ink-dim dark:text-ink-dim-dark">
            set by GOODIES_BEACON_HOST
          </span>
        </dd>
      </dl>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={timezoneId} className="block text-sm font-medium">
            Time zone
          </label>
          <input
            id={timezoneId}
            name="timezone"
            value={form.timezone}
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            className="mt-2 w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm outline-none focus:border-beacon dark:border-edge-dark dark:bg-paper-dark"
          />
          <p className="mt-1.5 text-xs text-ink-dim dark:text-ink-dim-dark">
            An IANA name, such as Europe/London.
          </p>
        </div>

        <div>
          <label htmlFor={digestId} className="block text-sm font-medium">
            Digest time
          </label>
          <input
            id={digestId}
            name="digestTime"
            type="time"
            value={form.digestTime}
            onChange={(event) => setForm({ ...form, digestTime: event.target.value })}
            className="mt-2 w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm outline-none focus:border-beacon dark:border-edge-dark dark:bg-paper-dark"
          />
          <p className="mt-1.5 text-xs text-ink-dim dark:text-ink-dim-dark">
            When the daily digest is sent, in your time zone.
          </p>
        </div>
      </div>

      {save.isError ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {save.error instanceof ApiError ? save.error.message : 'Could not save.'}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending || unchanged}
          className="rounded-lg bg-beacon px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Save
        </button>
        {save.isSuccess && unchanged ? (
          <span role="status" className="text-sm text-ink-dim dark:text-ink-dim-dark">
            Saved.
          </span>
        ) : null}
      </div>
    </form>
  );
}
