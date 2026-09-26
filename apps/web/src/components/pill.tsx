/**
 * A small uppercase label for a fixed value — a status, a notification mode. The tint is
 * translucent so it reads on the page and on a raised card alike.
 */
export function Pill({ children }: { children: string }) {
  return (
    <span className="rounded bg-edge/70 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-ink dark:bg-edge-dark/70 dark:text-ink-dark">
      {children}
    </span>
  );
}
