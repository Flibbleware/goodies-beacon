import { type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * A modal on the browser's own `<dialog>`, opened with `showModal()`: focus is trapped inside, Esc
 * closes it, the page behind is inert, and focus goes back to whatever opened it — none of which
 * is written here, and so none of which can be got wrong here.
 *
 * `onClose` is called however it closes — Esc, the backdrop, or the owner's own button — so the
 * caller's `open` never disagrees with the element. While `hold` is set, Esc and the backdrop call
 * `onHeld` instead of closing, so a modal with something to lose can ask first.
 */
export function Modal({
  open,
  onClose,
  title,
  wide = false,
  hold = false,
  onHeld,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  hold?: boolean;
  onHeld?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard way out is Esc, which a modal dialog handles natively
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onClose={onClose}
      onCancel={(event) => {
        if (!hold) return;
        event.preventDefault();
        onHeld?.();
      }}
      // The panel fills the dialog edge to edge, so a click whose target is the dialog itself
      // landed on the backdrop around it.
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (hold) onHeld?.();
        else onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${wide ? 'max-w-3xl' : 'max-w-lg'} overflow-y-auto rounded-xl border border-edge bg-paper-raised p-0 text-ink shadow-xl backdrop:bg-black/40 dark:border-edge-dark dark:bg-paper-raised-dark dark:text-ink-dark`}
    >
      <div className="p-5">
        <h2 id={headingId} className="font-medium">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}
