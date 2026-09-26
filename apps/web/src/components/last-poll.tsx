import { useState } from 'react';
import { ClockIcon } from './icons.js';

export interface PollFacts {
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  failingPlans: number;
}

/**
 * When an item last polled, in §6's terms: a plan failing now that worked before is "failing
 * since", not simply "failed", because the difference is what you act on. The date sits behind a
 * clock rather than being spelled out. The clock is a button that toggles on a click as well as
 * showing on hover and focus, because iOS Safari does not focus a button it is tapped on.
 *
 * Raised above its surroundings so the item card's stretched link does not swallow the hover.
 */
export function LastPoll({ poll, countPlans = false }: { poll: PollFacts; countPlans?: boolean }) {
  const [open, setOpen] = useState(false);
  const { label, at } = describe(poll, countPlans);
  const failing = poll.failingPlans > 0;
  const when = at
    ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <span
      className={`group relative z-10 inline-flex items-center gap-1 ${failing ? 'text-red-600 dark:text-red-400' : ''}`}
    >
      {label}
      {when && at ? (
        <>
          <button
            type="button"
            aria-label={`${label} ${when}`}
            aria-expanded={open}
            onClick={() => setOpen((shown) => !shown)}
            onBlur={() => setOpen(false)}
            className="rounded p-0.5 hover:text-ink dark:hover:text-ink-dark"
          >
            <ClockIcon className="size-3.5" />
          </button>
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-paper shadow transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-ink-dark dark:text-paper-dark ${open ? 'opacity-100' : 'opacity-0'}`}
          >
            <time dateTime={at}>{when}</time>
          </span>
        </>
      ) : null}
    </span>
  );
}

function describe(poll: PollFacts, countPlans: boolean): { label: string; at: string | null } {
  if (poll.failingPlans > 0) {
    const plans = countPlans
      ? `${poll.failingPlans} ${poll.failingPlans === 1 ? 'plan' : 'plans'} failing`
      : 'Failing';
    return poll.lastSuccessAt
      ? { label: `${plans} since`, at: poll.lastSuccessAt }
      : { label: `${plans}, never succeeded`, at: null };
  }
  if (!poll.lastPollAt) return { label: 'Never polled', at: null };
  return { label: 'Last polled', at: poll.lastPollAt };
}
