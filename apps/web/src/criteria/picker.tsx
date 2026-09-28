import { matchesSharedCriterion } from '@goodies-beacon/core/schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { type SharedCriterionRow, sharedCriteriaQuery } from '../api/criteria.js';
import { CriterionFlags } from '../components/criterion-flags.js';
import { Button, CONTROL } from '../components/form.js';
import { PROMPT_INLINE } from '../components/prompt-text.js';
import { TagPills } from '../components/tag-pills.js';

/**
 * Finding a shared criterion to add to an item (P1-27), by part of its identifier or a tag. One
 * the spec already holds is listed as added rather than hidden, so a search for it does not look
 * as if it had gone.
 */
export function SharedCriterionPicker({
  taken,
  onPick,
  onClose,
}: {
  /** The ids of the criteria the spec already holds. */
  taken: ReadonlySet<string>;
  onPick: (criterion: SharedCriterionRow) => void;
  onClose: () => void;
}) {
  const { data, isPending, isError } = useQuery(sharedCriteriaQuery);
  const [query, setQuery] = useState('');
  const criteria = data?.criteria ?? [];
  const shown = criteria.filter((criterion) => matchesSharedCriterion(criterion, query));

  return (
    <section
      aria-label="Add a shared criterion"
      className="rounded-lg border border-edge p-4 dark:border-edge-dark"
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">Add a Shared Criterion</h4>
        <Button type="button" variant="quiet" onClick={onClose}>
          Done
        </Button>
      </div>
      <input
        type="search"
        aria-label="Find a shared criterion by identifier or tag"
        placeholder="Identifier or tag…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className={CONTROL}
      />

      {isPending ? (
        <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          Could not load the shared criteria.
        </p>
      ) : null}
      {data && criteria.length === 0 ? (
        <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
          There are none yet; they are made on the{' '}
          <Link to="/criteria" className="text-beacon hover:underline">
            Criteria
          </Link>{' '}
          page.
        </p>
      ) : null}
      {criteria.length > 0 && shown.length === 0 ? (
        <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
          Nothing matches “{query.trim()}”.
        </p>
      ) : null}

      {shown.length > 0 ? (
        <ul aria-label="Shared criteria" className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {shown.map((criterion) => {
            const added = taken.has(criterion.key);
            return (
              <li
                key={criterion.id}
                className="flex items-start gap-3 rounded-lg border border-edge p-3 dark:border-edge-dark"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <code className="font-mono text-xs font-medium break-all">{criterion.key}</code>
                    <TagPills tags={criterion.tags} onPick={setQuery} />
                  </div>
                  <p className={`mt-1.5 ${PROMPT_INLINE} whitespace-pre-wrap`}>{criterion.text}</p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <CriterionFlags
                      kind={criterion.kind}
                      onUnknown={criterion.onUnknown}
                      quantifiable={criterion.quantifiable}
                    />
                  </p>
                </div>
                <Button
                  type="button"
                  variant="quiet"
                  disabled={added}
                  aria-label={added ? `${criterion.key} is added` : `Add ${criterion.key}`}
                  onClick={() => onPick(criterion)}
                >
                  {added ? 'Added' : 'Add'}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
