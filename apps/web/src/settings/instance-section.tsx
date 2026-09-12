import type { PublicSettings } from '@goodies-beacon/core/schemas';
import { settingsPatchSchema } from '@goodies-beacon/core/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError } from '../api/client.js';
import { saveSettings, settingsQuery } from '../api/settings.js';
import { Alert, Button, CONTROL, Field, Section } from '../components/form.js';
import { fieldErrors } from './validate.js';

type Instance = PublicSettings['instance'];

export function InstanceSection({ instance, host }: { instance: Instance; host: string }) {
  const queryClient = useQueryClient();
  const timezoneId = useId();
  const digestId = useId();
  const [form, setForm] = useState(instance);

  // A save from elsewhere, or a refetch, should win over an untouched form.
  useEffect(() => setForm(instance), [instance]);

  const errors = fieldErrors(settingsPatchSchema, { instance: form }, 'instance');
  const unchanged = form.timezone === instance.timezone && form.digestTime === instance.digestTime;

  const save = useMutation({
    mutationFn: () => saveSettings({ instance: form }),
    onSuccess: (saved) => queryClient.setQueryData(settingsQuery.queryKey, saved),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Section title="Instance">
      <form onSubmit={onSubmit}>
        <dl className="mt-4 flex flex-wrap items-baseline gap-3 text-sm">
          <dt className="text-ink-dim dark:text-ink-dim-dark">Address</dt>
          <dd>
            <code>{host}</code>
            <span className="ml-2 text-xs text-ink-dim dark:text-ink-dim-dark">
              set by GOODIES_BEACON_HOST
            </span>
          </dd>
        </dl>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field
            id={timezoneId}
            label="Time zone"
            hint="An IANA name, such as Europe/London."
            error={errors.timezone}
          >
            <input
              id={timezoneId}
              name="timezone"
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              className={CONTROL}
            />
          </Field>

          <Field
            id={digestId}
            label="Digest time"
            hint="When the daily digest is sent, in your time zone."
            error={errors.digestTime}
          >
            <input
              id={digestId}
              name="digestTime"
              type="time"
              value={form.digestTime}
              onChange={(event) => setForm({ ...form, digestTime: event.target.value })}
              className={CONTROL}
            />
          </Field>
        </div>

        {save.isError ? (
          <Alert tone="error">
            {save.error instanceof ApiError ? save.error.message : 'Could not save.'}
          </Alert>
        ) : null}

        <div className="mt-6 flex items-center gap-3">
          <Button
            type="submit"
            disabled={save.isPending || unchanged || Object.keys(errors).length > 0}
          >
            Save
          </Button>
          {save.isSuccess && unchanged ? (
            <span role="status" className="text-sm text-ink-dim dark:text-ink-dim-dark">
              Saved.
            </span>
          ) : null}
        </div>
      </form>
    </Section>
  );
}
