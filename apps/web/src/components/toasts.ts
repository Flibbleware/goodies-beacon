export type ToastTone = 'ok' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

/** How long each stays, in milliseconds: a failure is left up longer, being the one to act on. */
export const TOAST_LIFETIME: Record<ToastTone, number> = { ok: 4_000, error: 8_000 };

/** The most shown at once; a new one past this pushes out the oldest. */
export const MAX_TOASTS = 3;

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function publish(next: readonly Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

function forget(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

function show(tone: ToastTone, message: string): number {
  const id = nextId++;
  const all = [...toasts, { id, tone, message }];
  for (const dropped of all.slice(0, -MAX_TOASTS)) forget(dropped.id);
  publish(all.slice(-MAX_TOASTS));
  timers.set(
    id,
    setTimeout(() => dismissToast(id), TOAST_LIFETIME[tone]),
  );
  return id;
}

/**
 * The toasts that confirm a save or report that it failed (P1-32). A module rather than a React
 * context so a mutation's callbacks can call it as they are, and a toast raised by a dialog that
 * then unmounts, or by a page just navigated away from, still shows.
 */
export const toast = {
  ok: (message: string) => show('ok', message),
  error: (message: string) => show('error', message),
};

export function dismissToast(id: number) {
  forget(id);
  if (toasts.some((each) => each.id === id)) publish(toasts.filter((each) => each.id !== id));
}

export function subscribeToToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentToasts(): readonly Toast[] {
  return toasts;
}

/** For tests: everything cleared, as on a fresh page. */
export function resetToasts() {
  for (const id of timers.keys()) forget(id);
  nextId = 1;
  publish([]);
}
