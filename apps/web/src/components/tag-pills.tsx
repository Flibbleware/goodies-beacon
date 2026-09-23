const PILL =
  'inline-flex items-center rounded-full border border-edge px-2 py-0.5 text-xs text-ink-dim dark:border-edge-dark dark:text-ink-dim-dark';

/**
 * Free-text tags as pills, in the order they were entered (P1-21). With `onPick`, each is a button
 * that filters by its tag. Spans rather than a list, so a row's tags are not counted as rows of the
 * list the row sits in.
 */
export function TagPills({
  tags,
  onPick,
}: {
  tags: readonly string[];
  onPick?: ((tag: string) => void) | undefined;
}) {
  if (tags.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tags.map((tag) =>
        onPick ? (
          <button
            key={tag}
            type="button"
            title={`Filter by ${tag}`}
            onClick={() => onPick(tag)}
            className={`${PILL} hover:border-beacon hover:text-beacon`}
          >
            {tag}
          </button>
        ) : (
          <span key={tag} className={PILL}>
            {tag}
          </span>
        ),
      )}
    </span>
  );
}
