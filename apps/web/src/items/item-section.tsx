import { type ReactNode, useId, useState } from 'react';
import { ChevronIcon, EditIcon } from '../components/icons.js';

/**
 * One section of the item page (P1-24): a heading that folds it away, and beside it a pencil that
 * opens the section's own editor when it has one.
 *
 * Sections start folded unless `defaultOpen`. Folded or open, once chosen, is remembered per
 * section name rather than per item, in the browser only: it is how the owner likes the page laid
 * out, not a fact about any one item. Storage can be missing or refuse (a private window), so it is
 * only ever a preference and the page works without it.
 */
export function ItemSection({
  title,
  defaultOpen = false,
  onEdit,
  flag,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  /** Opens the section's editor; a section without one has no pencil. */
  onEdit?: (() => void) | undefined;
  /** What the section still needs before the item can poll (P1-26): a red mark beside it. */
  flag?: string | undefined;
  children: ReactNode;
}) {
  const headingId = useId();
  const bodyId = useId();
  const key = `gb.item-section.${title}`;
  const [open, setOpen] = useState(() => readOpen(key, defaultOpen));

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? 'closed' : 'open');
    } catch {}
  };

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className="flex items-center gap-1">
        <h2 id={headingId} className="font-medium">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
            className="-ml-1 flex items-center gap-1.5 rounded px-1 hover:bg-paper-raised dark:hover:bg-paper-raised-dark"
          >
            <ChevronIcon
              className={`size-4 text-ink-dim transition-transform dark:text-ink-dim-dark ${open ? '' : '-rotate-90'}`}
            />
            {title}
          </button>
        </h2>
        {flag ? (
          <span
            role="img"
            aria-label={`Needed before polling. ${flag}`}
            title={flag}
            className="inline-flex size-4.5 items-center justify-center rounded-full bg-red-600 text-[0.6875rem] font-bold text-white dark:bg-red-500"
          >
            !
          </span>
        ) : null}
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${title.toLowerCase()}`}
            title={`Edit ${title.toLowerCase()}`}
            className="rounded p-1 text-ink-dim hover:bg-paper-raised hover:text-ink dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark dark:hover:text-ink-dark"
          >
            <EditIcon />
          </button>
        ) : null}
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'open';
  } catch {
    return fallback;
  }
}
