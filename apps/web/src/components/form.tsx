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
  hint?: string;
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
 * `aria-labelledby` makes each section a named landmark, so a screen reader can jump between
 * them — and so a test can say which section's Save button it means.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 rounded-xl border border-edge bg-paper-raised p-6 dark:border-edge-dark dark:bg-paper-raised-dark"
    >
      <h2 id={headingId} className="font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  const style =
    variant === 'primary'
      ? 'bg-beacon text-white'
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

export function Alert({ tone, children }: { tone: 'error' | 'ok'; children: ReactNode }) {
  const style =
    tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-ink-dim dark:text-ink-dim-dark';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${style}`}>
      {children}
    </p>
  );
}

export { CONTROL };
