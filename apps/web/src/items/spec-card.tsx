import type { Criterion, ReferenceImage, WantedSpec } from '@goodies-beacon/core/schemas';
import { lintSpec } from '@goodies-beacon/core/schemas';
import { useId } from 'react';

/**
 * The current spec, rendered in full and human-readable (§8).
 *
 * "Nothing is a black box" is the requirement this satisfies: every criterion in plain English
 * with its hard/soft, quantifiable and on-unknown flags, the settings as the bounded values they
 * are, and the reference images with the labels the reviewer is shown. Editing it is still the
 * JSON editor next door — §17 gives the typed form to the interviewer phase — so this is a
 * reading view with a link, not a form.
 */
export function SpecCard({ spec }: { spec: WantedSpec }) {
  const headingId = useId();
  const warnings = new Map(lintSpec(spec).map((warning) => [warning.criterionId, warning.message]));

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="font-medium">
        Current spec
      </h2>

      <div className="mt-3 space-y-6 rounded-xl border border-edge p-5 dark:border-edge-dark">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
            Summary
          </h3>
          <p className="mt-1.5 text-sm">
            {spec.summary || <Absent>No summary was written.</Absent>}
          </p>
          {spec.plausibilityNote ? (
            <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
              <span className="font-medium">Note for the pre-filter: </span>
              {spec.plausibilityNote}
            </p>
          ) : null}
        </div>

        <Settings spec={spec} />
        <Criteria criteria={spec.criteria} warnings={warnings} />
        <References images={spec.referenceImages} />
      </div>
    </section>
  );
}

/**
 * §4's settings/criteria split made visible: everything with a bounded set of values, shown as the
 * value it is. A price or a country appearing under Criteria instead would be the leak §4 warns
 * about, and the two groups are side by side so it would be obvious.
 */
function Settings({ spec }: { spec: WantedSpec }) {
  const s = spec.settings;
  const ceiling = s.priceCeiling;

  const rows: [string, string][] = [
    ['Marketplaces', s.sources.length > 0 ? s.sources.join(', ') : 'none'],
    ['Listing types', s.listingTypes.join(' and ')],
    ['Price ceiling', ceiling ? `£${ceiling.amount}` : 'any price'],
    ['Condition', s.conditionCategory],
    ['Ships to the UK', SHIPS_TO_UK[s.shipsToUk]],
    ['Notifications', s.notificationMode === 'realtime' ? 'real-time email' : 'daily digest'],
    ['Poll every', s.pollEvery ?? 'the instance default'],
    ['Relists', s.relists === 'show' ? 'shown, flagged as seen before' : 'suppressed'],
    ['When unknown', s.defaultOnUnknown === 'surface' ? 'surface as uncertain' : 'reject'],
    ['Negative keywords', s.negativeKeywords.join(', ') || 'none'],
    ['Grading', s.minimumGrade ? `at least ${s.minimumGrade}` : 'no scale attached'],
    [
      'Backfill',
      s.backfill.enabled ? `on first agreement, ${s.backfill.depth.replace('_', ' ')}` : 'off',
    ],
  ];

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
        Settings
      </h3>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-ink-dim dark:text-ink-dim-dark">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const SHIPS_TO_UK = {
  show_all: 'show everything, flagged',
  flag: 'show everything, flagged',
  only: 'only listings that ship here',
} as const;

function Criteria({
  criteria,
  warnings,
}: {
  criteria: Criterion[];
  warnings: Map<string, string>;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
        Criteria
      </h3>

      {criteria.length === 0 ? (
        <p className="mt-2 text-sm">
          <Absent>Nothing is judged by reading or looking; the settings decide everything.</Absent>
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {criteria.map((criterion) => (
            <li key={criterion.id}>
              <p className="text-sm">{criterion.text}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-dim dark:text-ink-dim-dark">
                <span>{criterion.kind === 'hard' ? 'hard — rejects' : 'soft — uncertain'}</span>
                <span>
                  {criterion.quantifiable
                    ? 'the photos can settle it'
                    : 'the photos may not settle it'}
                </span>
                <span>unknown → {criterion.onUnknown === 'surface' ? 'uncertain' : 'reject'}</span>
              </p>
              {warnings.has(criterion.id) ? (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                  {warnings.get(criterion.id)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The label is what the reviewer is told each photograph is of, so it is shown, not the id. */
function References({ images }: { images: ReferenceImage[] }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
        Reference images
      </h3>

      {images.length === 0 ? (
        <p className="mt-2 text-sm">
          <Absent>None. The reviewer judges from the criteria alone.</Absent>
        </p>
      ) : (
        <>
          <ul className="mt-2 flex flex-wrap gap-4">
            {images.map((image) => (
              <li key={image.id} className="w-28">
                <img
                  src={`/api/media/${image.id}/thumb`}
                  alt={image.label || 'Reference image'}
                  className="h-28 w-28 rounded-lg border border-edge object-cover dark:border-edge-dark"
                />
                <p className="mt-1 text-xs text-ink-dim dark:text-ink-dim-dark">
                  {image.label || 'unlabelled'}
                </p>
              </li>
            ))}
          </ul>
          {/* §9: each one is re-sent on every review of this item, so the number is worth seeing. */}
          <p className="mt-3 text-xs text-ink-dim dark:text-ink-dim-dark">
            {images.length} image{images.length === 1 ? '' : 's'} sent with every review of this
            item.
            {images.length >= 6 ? ' That is a lot; each one costs tokens every time.' : ''}
          </p>
        </>
      )}
    </div>
  );
}

function Absent({ children }: { children: string }) {
  return <span className="text-ink-dim dark:text-ink-dim-dark">{children}</span>;
}
