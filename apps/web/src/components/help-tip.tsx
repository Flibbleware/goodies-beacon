import { useEffect, useId, useRef, useState } from 'react';
import { HelpIcon } from './icons.js';

/**
 * A "?" that explains the thing beside it, on hover, on keyboard focus and on a tap.
 *
 * Not a `title`, which is what every other hint here is: a title shows only to a mouse that
 * lingers, so on a phone the "?" would do nothing at all. The text is the button's description
 * whether or not it is showing, so a screen reader hears it on reaching the button.
 */
export function HelpTip({ label, children }: { label: string; children: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  // A tap elsewhere closes it; a touch browser does not always move focus off a tapped button.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        onClick={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className="rounded-full text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-beacon dark:text-ink-dim-dark dark:hover:text-ink-dark"
      >
        <HelpIcon className="size-4" />
      </button>
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="absolute top-full left-0 z-10 mt-1.5 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-edge bg-paper-raised px-3 py-2 text-xs font-normal normal-case tracking-normal text-ink shadow-lg dark:border-edge-dark dark:bg-paper-raised-dark dark:text-ink-dark"
      >
        {children}
      </span>
    </span>
  );
}
