import { changePasswordSchema } from '@goodies-beacon/core/schemas';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../api/client.js';
import { changePassword } from '../api/settings.js';
import { Alert, Button, CONTROL, Field, Section } from '../components/form.js';

export function AccountSection() {
  const currentId = useId();
  const newId = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
  const newPasswordError = newPassword === '' ? undefined : errorFor(parsed, 'newPassword');

  const change = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate();
  };

  return (
    <Section title="Account">
      <form onSubmit={onSubmit}>
        <p className="mt-2 text-sm text-ink-dim dark:text-ink-dim-dark">
          Changing your password signs out every other browser.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field id={currentId} label="Current password">
            <input
              id={currentId}
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={CONTROL}
            />
          </Field>

          <Field
            id={newId}
            label="New password"
            hint="At least 8 characters."
            error={newPasswordError}
          >
            <input
              id={newId}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={CONTROL}
            />
          </Field>
        </div>

        {change.isError ? (
          <Alert tone="error">
            {change.error instanceof ApiError ? change.error.message : 'Could not change it.'}
          </Alert>
        ) : null}

        {change.isSuccess ? <Alert tone="ok">Password changed.</Alert> : null}

        <div className="mt-6">
          <Button type="submit" disabled={change.isPending || !parsed.success}>
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}

function errorFor(
  parsed: ReturnType<typeof changePasswordSchema.safeParse>,
  field: string,
): string | undefined {
  if (parsed.success) return undefined;
  return parsed.error.issues.find((issue) => issue.path[0] === field)?.message;
}
