import type { PublicSettings, SettingsPatch } from '@goodies-beacon/core/schemas';
import {
  isEmailConfigured,
  SMTP_SECURITIES,
  settingsPatchSchema,
} from '@goodies-beacon/core/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError } from '../api/client.js';
import { saveSettings, sendTestEmail, settingsQuery } from '../api/settings.js';
import { Alert, Button, CONTROL, Field, Section } from '../components/form.js';
import { fieldErrors } from './validate.js';

type Email = PublicSettings['email'];

const SECURITY_LABELS: Record<(typeof SMTP_SECURITIES)[number], string> = {
  starttls: 'STARTTLS (port 587)',
  tls: 'TLS (port 465)',
  none: 'None (no encryption)',
};

/** Stands in for the stored password, which the server never sends back. */
const MASK = '••••••••';

export function EmailSection({ email }: { email: Email }) {
  const queryClient = useQueryClient();
  const ids = {
    host: useId(),
    port: useId(),
    security: useId(),
    username: useId(),
    password: useId(),
    from: useId(),
    to: useId(),
  };

  const [form, setForm] = useState(email);
  // Empty means "leave the stored password alone"; anything typed replaces it.
  const [password, setPassword] = useState('');

  useEffect(() => {
    setForm(email);
    setPassword('');
  }, [email]);

  const patch = buildPatch(form, password, email);
  const errors = fieldErrors(settingsPatchSchema, patch, 'email');
  const dirty = Object.keys(patch.email ?? {}).length > 0;
  const invalid = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: () => saveSettings(patch),
    onSuccess: (saved) => queryClient.setQueryData(settingsQuery.queryKey, saved),
  });

  /**
   * Saves anything unsaved before testing, because the server tests the stored settings rather
   * than whatever is on screen — an endpoint that mails using unsaved input would be a way to
   * make the instance send to an address it never agreed to keep.
   */
  const test = useMutation({
    mutationFn: async () => {
      if (dirty) {
        const saved = await saveSettings(patch);
        queryClient.setQueryData(settingsQuery.queryKey, saved);
      }
      return sendTestEmail();
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const busy = save.isPending || test.isPending;

  return (
    <Section title="Email">
      <form onSubmit={onSubmit}>
        <p className="mt-2 text-sm text-ink-dim dark:text-ink-dim-dark">
          Where notifications about matching listings are sent from and to.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field id={ids.host} label="SMTP host" error={errors.host}>
            <input
              id={ids.host}
              name="host"
              autoComplete="off"
              placeholder="smtp.example.com"
              value={form.host}
              onChange={(event) => setForm({ ...form, host: event.target.value })}
              className={CONTROL}
            />
          </Field>

          <Field id={ids.port} label="Port" error={errors.port}>
            <input
              id={ids.port}
              name="port"
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
              className={CONTROL}
            />
          </Field>

          <Field id={ids.security} label="Security" error={errors.security}>
            <select
              id={ids.security}
              name="security"
              value={form.security}
              onChange={(event) =>
                setForm({ ...form, security: event.target.value as Email['security'] })
              }
              className={CONTROL}
            >
              {SMTP_SECURITIES.map((value) => (
                <option key={value} value={value}>
                  {SECURITY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            id={ids.username}
            label="Username"
            hint="Leave empty if the server wants no login."
          >
            <input
              id={ids.username}
              name="username"
              autoComplete="off"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              className={CONTROL}
            />
          </Field>

          <Field
            id={ids.password}
            label="Password"
            hint={
              email.passwordSet
                ? 'Stored encrypted. Leave it alone to keep it; type to replace it.'
                : 'Stored encrypted, and never shown again.'
            }
          >
            <input
              id={ids.password}
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder={email.passwordSet ? MASK : ''}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={CONTROL}
            />
          </Field>

          <Field
            id={ids.from}
            label="From address"
            hint="What recipients see. Some servers insist it matches the account."
            error={errors.fromAddress}
          >
            <input
              id={ids.from}
              name="fromAddress"
              type="email"
              value={form.fromAddress}
              onChange={(event) => setForm({ ...form, fromAddress: event.target.value })}
              className={CONTROL}
            />
          </Field>

          <Field
            id={ids.to}
            label="Notification address"
            hint="Your inbox. Test emails and notifications go here."
            error={errors.notificationAddress}
          >
            <input
              id={ids.to}
              name="notificationAddress"
              type="email"
              value={form.notificationAddress}
              onChange={(event) => setForm({ ...form, notificationAddress: event.target.value })}
              className={CONTROL}
            />
          </Field>
        </div>

        {save.isError ? (
          <Alert tone="error">
            {save.error instanceof ApiError ? save.error.message : 'Could not save.'}
          </Alert>
        ) : null}

        {test.isError ? (
          <Alert tone="error">
            {test.error instanceof ApiError
              ? `The mail server said: ${test.error.message}`
              : 'Could not send the test email.'}
          </Alert>
        ) : null}

        {test.isSuccess ? <Alert tone="ok">Test email sent to {test.data.sentTo}.</Alert> : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !dirty || invalid}>
            Save
          </Button>
          <Button
            type="button"
            variant="quiet"
            onClick={() => test.mutate()}
            disabled={busy || invalid || !isEmailConfigured(form)}
          >
            {test.isPending ? 'Sending…' : 'Send test email'}
          </Button>
          {save.isSuccess && !dirty ? (
            <span role="status" className="text-sm text-ink-dim dark:text-ink-dim-dark">
              Saved.
            </span>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

/**
 * Only what has actually changed. A field left alone is left out, which is what keeps the stored
 * SMTP password — the browser never has it to send back, so "unchanged" has to mean "absent".
 */
function buildPatch(form: Email, password: string, current: Email): SettingsPatch {
  const email: NonNullable<SettingsPatch['email']> = {};

  if (form.host !== current.host) email.host = form.host;
  if (form.port !== current.port) email.port = form.port;
  if (form.security !== current.security) email.security = form.security;
  if (form.username !== current.username) email.username = form.username;
  if (form.fromAddress !== current.fromAddress) email.fromAddress = form.fromAddress;
  if (form.notificationAddress !== current.notificationAddress) {
    email.notificationAddress = form.notificationAddress;
  }
  if (password !== '') email.password = password;

  return Object.keys(email).length > 0 ? { email } : {};
}
