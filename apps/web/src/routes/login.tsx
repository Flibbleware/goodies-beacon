import { useMutation } from '@tanstack/react-query';
import { createRoute, redirect, useRouter } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { loadSession, login, setFirstPassword } from '../api/auth.js';
import { ApiError } from '../api/client.js';
import { rootRoute } from './root.js';

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async ({ context }) => {
    const session = await loadSession(context.queryClient);
    // Already signed in: there is nothing to do here.
    if (session.authenticated) throw redirect({ to: '/' });
    return { firstRun: session.firstRun };
  },
  component: LoginPage,
});

function LoginPage() {
  const { firstRun } = loginRoute.useRouteContext();
  const router = useRouter();
  const passwordId = useId();
  const [password, setPassword] = useState('');

  const submit = useMutation({
    mutationFn: (value: string) => (firstRun ? setFirstPassword(value) : login(value)),
    // The guard asks the API again on the way in, so there is no client-side state to update:
    // the cookie is already set, and the server is what decides.
    onSuccess: () => router.navigate({ to: '/' }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate(password);
  };

  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Goodies Beacon</h1>
          <p className="mt-2 text-sm text-ink-dim dark:text-ink-dim-dark">
            {firstRun
              ? 'Choose a password. It is the only one, so make it a good one.'
              : 'Sign in to your instance.'}
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-edge bg-paper-raised p-6 dark:border-edge-dark dark:bg-paper-raised-dark"
        >
          <label htmlFor={passwordId} className="block text-sm font-medium">
            Password
          </label>
          <input
            id={passwordId}
            type="password"
            name="password"
            autoComplete={firstRun ? 'new-password' : 'current-password'}
            // biome-ignore lint/a11y/noAutofocus: the only field on the page the visitor came for
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm outline-none focus:border-beacon dark:border-edge-dark dark:bg-paper-dark"
          />
          {firstRun ? (
            <p className="mt-2 text-xs text-ink-dim dark:text-ink-dim-dark">
              At least 8 characters.
            </p>
          ) : null}

          {submit.isError ? (
            <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
              {messageFor(submit.error)}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submit.isPending || password === ''}
            className="mt-6 w-full rounded-lg bg-beacon px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {firstRun ? 'Set password' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

/** The API's message is written for the person reading it, so it is shown as it came. */
function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Could not reach the server. Is it running?';
}
