import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckIcon, CloseIcon } from './icons.js';
import { currentToasts, dismissToast, subscribeToToasts, type Toast } from './toasts.js';

let hosts: readonly HTMLDialogElement[] = [];
const hostListeners = new Set<() => void>();

function setHosts(next: readonly HTMLDialogElement[]) {
  hosts = next;
  for (const listener of hostListeners) listener();
}

const subscribeToHosts = (listener: () => void) => {
  hostListeners.add(listener);
  return () => hostListeners.delete(listener);
};

const currentHost = () => hosts.at(-1) ?? null;

/**
 * Called by `Modal` while it is open, so toasts are drawn inside it. Everything outside a modal
 * dialog is inert, so a toast left in the page would show but could not be dismissed, and a screen
 * reader would never reach it.
 */
export function hostToasts(dialog: HTMLDialogElement): () => void {
  setHosts([...hosts, dialog]);
  return () => setHosts(hosts.filter((each) => each !== dialog));
}

/**
 * Where `toast.ok` and `toast.error` land, at the right from a tablet up: at the foot of a page,
 * whose own actions are at its head, and at the head while a dialog is open, whose Save and Cancel
 * are at its foot — the two buttons wanted next after a failure.
 *
 * The region is a manual popover, so it is in the top layer with the modal `<dialog>`s; anything
 * outside it is drawn beneath a modal's backdrop, whatever its z-index. Moving it into a newly
 * opened modal mounts it afresh, and so shows it after that dialog, which puts it on top.
 */
export function Toaster() {
  const host = useSyncExternalStore(subscribeToHosts, currentHost);
  return createPortal(<Region inDialog={host !== null} />, host ?? document.body);
}

function Region({ inDialog }: { inDialog: boolean }) {
  const toasts = useSyncExternalStore(subscribeToToasts, currentToasts);
  const region = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!region.current?.matches(':popover-open')) region.current?.showPopover();
  }, []);

  return (
    <section
      ref={region}
      popover="manual"
      aria-label="Notifications"
      className={`inset-auto ${inDialog ? 'top-4' : 'bottom-4'} right-4 left-4 m-0 w-auto overflow-visible border-0 bg-transparent p-0 text-ink sm:left-auto sm:w-96 dark:text-ink-dark`}
    >
      <ol className="flex flex-col gap-2">
        {toasts.map((each) => (
          <ToastEntry key={each.id} toast={each} />
        ))}
      </ol>
    </section>
  );
}

function ToastEntry({ toast }: { toast: Toast }) {
  const failed = toast.tone === 'error';
  const Icon = failed ? AlertIcon : CheckIcon;

  return (
    <li
      role={failed ? 'alert' : 'status'}
      className="flex items-start gap-3 rounded-lg border border-edge bg-paper-raised py-3 pr-3 pl-4 text-sm shadow-lg dark:border-edge-dark dark:bg-paper-raised-dark"
    >
      <Icon
        className={`mt-px size-4 shrink-0 ${failed ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
      />
      <p className="min-w-0 flex-1 break-words">{toast.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(toast.id)}
        className="-my-0.5 rounded p-0.5 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-beacon dark:text-ink-dim-dark dark:hover:text-ink-dark"
      >
        <CloseIcon className="size-4" />
      </button>
    </li>
  );
}
