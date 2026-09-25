import type { Criterion, ReferenceImage, WantedSpec } from '@goodies-beacon/core/schemas';
import { lintSpec } from '@goodies-beacon/core/schemas';
import type { ReactNode } from 'react';

/**
 * The current spec, rendered in full and human-readable (§8), in the parts the item page shows as
 * sections of their own (P1-24): what is being looked for, the settings, the criteria, and the
 * reference images. Each is a reading view; the pencil beside its heading opens its editor.
 *
 * "Nothing is a black box" is the requirement this satisfies: every criterion in plain English
 * with its hard/soft, quantifiable and on-unknown flags, the settings as the bounded values they
 * are, and the reference images with the labels the reviewer is shown.
 */
export function SpecDescription({ spec }: { spec: WantedSpec }) {
  return (
    <Card>
      <div>
        <Label>Summary</Label>
        <p className="mt-1.5 text-sm">{spec.summary || <Absent>No summary was written.</Absent>}</p>
      </div>
      <div>
        <Label>How sellers list this</Label>
        <p className="mt-1.5 text-sm">
          {spec.plausibilityNote || <Absent>Nothing written for the pre-filter.</Absent>}
        </p>
      </div>
    </Card>
  );
}

function Label({ children }: { children: string }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark">
      {children}
    </h3>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 space-y-6 rounded-xl border border-edge p-5 dark:border-edge-dark">
      {children}
    </div>
  );
}

/**
 * §4's settings/criteria split made visible: everything with a bounded set of values, shown as the
 * value it is. A price or a country appearing under Criteria instead would be the leak §4 warns
 * about, and the Criteria section sits directly beneath so it would be obvious.
 */
export function SpecSettings({ spec }: { spec: WantedSpec }) {
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
    <Card>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-ink-dim dark:text-ink-dim-dark">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const SHIPS_TO_UK = {
  show_all: 'show everything, flagged',
  flag: 'show everything, flagged',
  only: 'only listings that ship here',
} as const;

/**
 * The warnings come from the whole spec, because `lintSpec` judges a criterion against the item's
 * settings as well as its own flags.
 */
export function CriteriaList({ spec }: { spec: WantedSpec }) {
  const criteria: Criterion[] = spec.criteria;
  const warnings = new Map(lintSpec(spec).map((warning) => [warning.criterionId, warning.message]));

  return (
    <Card>
      {criteria.length === 0 ? (
        <p className="text-sm">
          <Absent>Nothing is judged by reading or looking; the settings decide everything.</Absent>
        </p>
      ) : (
        <ul className="space-y-3">
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
    </Card>
  );
}

/** The label is what the reviewer is told each photograph is of, so it is shown, not the id. */
export function ReferenceList({ images }: { images: ReferenceImage[] }) {
  return (
    <Card>
      {images.length === 0 ? (
        <p className="text-sm">
          <Absent>None. The reviewer judges from the criteria alone.</Absent>
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-4">
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
    </Card>
  );
}

function Absent({ children }: { children: string }) {
  return <span className="text-ink-dim dark:text-ink-dim-dark">{children}</span>;
}
