import type { Criterion, ReferenceImage, WantedSpec } from '@goodies-beacon/core/schemas';
import { durationToHours, lintSpec, scheduledHours } from '@goodies-beacon/core/schemas';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useLayoutEffect, useState } from 'react';
import { CriterionFlags } from '../components/criterion-flags.js';
import {
  BACKFILL_DEPTH_LABELS,
  CONDITION_LABELS,
  LISTING_TYPE_LABELS,
  NOTIFICATION_LABELS,
  ON_UNKNOWN_LABELS,
  RELIST_LABELS,
  SHIPS_TO_UK_LABELS,
  sourceLabel,
} from './labels.js';

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

  // In the editor's order and words; grading waits for Phase 5 and is not shown (P1-26).
  const rows: [string, string][] = [
    ['Marketplaces', s.sources.length > 0 ? s.sources.map(sourceLabel).join(', ') : 'none'],
    ['Listing types', s.listingTypes.map((type) => LISTING_TYPE_LABELS[type]).join(' and ')],
    ['Price ceiling', ceiling ? `£${ceiling.amount}` : 'Any price'],
    ['Negative keywords', s.negativeKeywords.join(', ') || 'None'],
    ['Poll every', pollEvery(s.pollEvery)],
    ['Notifications', NOTIFICATION_LABELS[s.notificationMode]],
    ['Relists', RELIST_LABELS[s.relists]],
    ['When unknown', ON_UNKNOWN_LABELS[s.defaultOnUnknown]],
    ['Condition', CONDITION_LABELS[s.conditionCategory]],
    ['Ships to the UK', SHIPS_TO_UK_LABELS[s.shipsToUk]],
    ['Backfill', s.backfill.enabled ? `On: ${BACKFILL_DEPTH_LABELS[s.backfill.depth]}` : 'Off'],
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

/** The interval as it will run: hours, rounded up as the scheduler rounds them. */
function pollEvery(duration: string | null): string {
  if (duration === null) return 'Every 8 hours (the default)';
  const hours = durationToHours(duration);
  if (hours === undefined) return duration;
  const runs = scheduledHours(hours);
  const every = `Every ${runs} hour${runs === 1 ? '' : 's'}`;
  return runs === hours ? every : `${every} (${hours} asked for)`;
}

/**
 * The warnings come from the whole spec, because `lintSpec` judges a criterion against the item's
 * settings as well as its own flags. `actions` draws each criterion's own controls beside it.
 */
export function CriteriaList({
  spec,
  actions,
}: {
  spec: WantedSpec;
  actions?: ((criterion: Criterion, index: number) => ReactNode) | undefined;
}) {
  const criteria: Criterion[] = spec.criteria;
  const warnings = new Map(lintSpec(spec).map((warning) => [warning.criterionId, warning.message]));

  return (
    <Card>
      {criteria.length === 0 ? (
        <p className="text-sm">
          <Absent>Nothing is judged by reading or looking; the settings decide everything.</Absent>
        </p>
      ) : (
        <ul className="-my-3 divide-y divide-edge dark:divide-edge-dark">
          {criteria.map((criterion, index) => (
            <li key={criterion.id} className="flex items-start gap-4 py-2.5">
              <div className="min-w-0 flex-1">
                <CriterionText text={criterion.text} />
                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <CriterionFlags
                    kind={criterion.kind}
                    onUnknown={criterion.onUnknown}
                    quantifiable={criterion.quantifiable}
                  />
                  {criterion.shared ? (
                    <span className="text-xs text-ink-dim dark:text-ink-dim-dark">
                      Shared:{' '}
                      <Link
                        to="/criteria"
                        search={{ q: criterion.shared }}
                        title="A shared criterion: edited on the Criteria page"
                        className="font-mono text-beacon hover:underline"
                      >
                        {criterion.shared}
                      </Link>
                    </span>
                  ) : null}
                </p>
                {warnings.has(criterion.id) ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
                    {warnings.get(criterion.id)}
                  </p>
                ) : null}
              </div>
              {actions ? (
                <div className="flex shrink-0 gap-1">{actions(criterion, index)}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * A criterion's text on one line, a step smaller and softer than the page's body text, so a list of
 * them does not glare. Text that does not fit ends in an ellipsis and opens in place on a click; the
 * tooltip carrying the whole of it appears only then, not on text that is already all showing.
 */
function CriterionText({ text }: { text: string }) {
  // State rather than a ref: the text moves into a button once it is clipped, and the observer has
  // to follow it to the new element.
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    if (!element || open) return;
    // Measured rather than guessed from the length, because what fits depends on the width.
    const measure = () => setClipped(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, open]);

  const body = `block text-[0.8125rem] text-ink/80 dark:text-ink-dark/80 ${open ? '' : 'truncate'}`;
  if (!clipped && !open) {
    return (
      <span ref={setElement} className={body}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      title={open ? undefined : text}
      onClick={() => setOpen(!open)}
      className="block w-full min-w-0 text-left hover:text-ink dark:hover:text-ink-dark"
    >
      <span ref={setElement} className={body}>
        {text}
      </span>
    </button>
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
