import { type ReactNode, useId } from 'react';

const CONTROL =
  'mt-2 w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm outline-none focus:border-beacon dark:border-edge-dark dark:bg-paper-dark';

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-ink-dim dark:text-ink-dim-dark">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A settings page: one section each since P1-23, so its title is the page heading. `aria-labelledby`
 * makes it a named landmark, so a test can say which section's Save button it means.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-2xl">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
        Settings
      </p>
      <h1 id={headingId} className="mt-1 text-xl font-semibold tracking-tight">
        {title}
      </h1>
      <div className="mt-6 rounded-xl border border-edge bg-paper-raised px-6 pt-4 pb-6 dark:border-edge-dark dark:bg-paper-raised-dark">
        {children}
      </div>
    </section>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  // The primary's border is transparent rather than absent, so the two stand the same height.
  const style =
    variant === 'primary'
      ? 'border border-transparent bg-beacon text-white'
      : 'border border-edge dark:border-edge-dark bg-paper dark:bg-paper-dark';
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${style}`}
    >
      {children}
    </button>
  );
}

const ALERT_STYLE = {
  error: 'text-red-600 dark:text-red-400',
  warn: 'text-amber-700 dark:text-amber-500',
  ok: 'text-ink-dim dark:text-ink-dim-dark',
};

export function Alert({ tone, children }: { tone: 'error' | 'warn' | 'ok'; children: ReactNode }) {
  const style = ALERT_STYLE[tone];
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${style}`}>
      {children}
    </p>
  );
}

export { CONTROL };
