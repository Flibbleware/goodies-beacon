import { useId } from 'react';
import type { LoadedItem } from '../api/items.js';

/**
 * A plain list: the side-by-side diff between two versions is Phase 3's, and what is needed now
 * is to see that a save made a version and what its note was.
 *
 * Shown on the item page, where §14 puts it, and again under the editor, where it is the proof
 * that a save wrote version N+1 rather than overwriting version N.
 */
export function VersionHistory({
  versions,
  currentId,
}: {
  versions: LoadedItem['versions'];
  currentId: string | undefined;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mt-10">
      <h2 id={headingId} className="font-medium">
        Version history
      </h2>
      <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
            <span className="text-sm font-medium">Version {version.version}</span>
            {version.id === currentId ? (
              <span className="rounded bg-paper-raised px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide dark:bg-paper-raised-dark">
                Current
              </span>
            ) : null}
            <time
              dateTime={version.createdAt}
              className="text-xs text-ink-dim dark:text-ink-dim-dark"
            >
              {new Date(version.createdAt).toLocaleString()}
            </time>
            <span className="w-full text-sm text-ink-dim dark:text-ink-dim-dark">
              {version.changeNote ?? 'No change note.'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
