import type { Criterion, ReferenceImage, WantedSpec } from '@goodies-beacon/core/schemas';
import {
  countryName,
  durationToHours,
  lintSpec,
  scheduledHours,
} from '@goodies-beacon/core/schemas';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useLayoutEffect, useState } from 'react';
import { CriterionFlags } from '../components/criterion-flags.js';
import { HelpTip } from '../components/help-tip.js';
import { PROMPT_INLINE, PromptBlock, ReadByLine } from '../components/prompt-text.js';
import { PanelAction } from './item-tabs.js';
import {
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
 * reference images. Each is a reading view; its editor is opened from the top of its tab.
 *
 * "Nothing is a black box" is the requirement this satisfies: every criterion in plain English
 * with its hard/soft, quantifiable and on-unknown flags, the settings as the bounded values they
 * are, and the reference images with the labels the reviewer is shown.
 */
export function SpecDescription({ spec }: { spec: WantedSpec }) {
  return (
    <Unboxed>
      <div>
        <Label>Summary</Label>
        <PromptBlock reader="both">
          {spec.summary || <Absent>No summary was written.</Absent>}
        </PromptBlock>
      </div>
      <div>
        <Label>How sellers list this</Label>
        <PromptBlock reader="prefilter">
          {spec.plausibilityNote || <Absent>Nothing written for the pre-filter.</Absent>}
        </PromptBlock>
      </div>
    </Unboxed>
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

/** Details and Settings are read as text under their tab, with no box around them (P1-28). */
function Unboxed({ children }: { children: ReactNode }) {
  return <div className="mt-4 space-y-6">{children}</div>;
}

/**
 * §4's settings/criteria split made visible: everything with a bounded set of values, shown as the
 * value it is. A price or a country appearing under Criteria instead would be the leak §4 warns
 * about, and the Criteria section sits directly beneath so it would be obvious.
 */
export function SpecSettings({
  spec,
  onEdit,
}: {
  spec: WantedSpec;
  /** Opens a group's own editor (P1-28); without it the groups have no buttons. */
  onEdit?: ((group: 'marketplace' | 'general') => void) | undefined;
}) {
  const s = spec.settings;

  // In the editors' order and words; grading and the backfill sweep wait for Phase 5 and are not
  // shown (P1-26, P1-36).
  const marketplace: [string, string][] = [
    ['Marketplaces', s.sources.length > 0 ? s.sources.map(sourceLabel).join(', ') : 'none'],
    ['Listing types', s.listingTypes.map((type) => LISTING_TYPE_LABELS[type]).join(' and ')],
    ['Negative keywords', s.negativeKeywords.join(', ') || 'None'],
    ['Relists', RELIST_LABELS[s.relists]],
    ['Condition', CONDITION_LABELS[s.conditionCategory]],
    ['Ships to the UK', SHIPS_TO_UK_LABELS[s.shipsToUk]],
    ['Only sellers in', s.sellerCountry ? countryName(s.sellerCountry) : 'Anywhere'],
    ['Sellers excluded in', s.excludedCountries.map(countryName).join(', ') || 'None'],
  ];
  const general: [string, string][] = [
    ['Price range', priceRange(s.priceRange)],
    ['When unknown', ON_UNKNOWN_LABELS[s.defaultOnUnknown]],
  ];

  // Unboxed, like Details, with room between the groups for each one's button.
  return (
    <div className="mt-4 space-y-10">
      <SettingsGroup
        title="Marketplace Settings"
        rows={marketplace}
        onEdit={onEdit ? () => onEdit('marketplace') : undefined}
      />
      <SettingsGroup
        title="General Settings"
        rows={general}
        onEdit={onEdit ? () => onEdit('general') : undefined}
      />
    </div>
  );
}

/**
 * The Notifications tab (P1-37): how each verdict is sent, and how often the item looks. One group,
 * so its editor is the panel's button, as Details' is.
 */
export function SpecNotifications({ spec }: { spec: WantedSpec }) {
  const s = spec.settings;
  return (
    <Unboxed>
      <SettingsGroup
        title="Notification Settings"
        rows={[
          ['Matches', NOTIFICATION_LABELS[s.matchNotifications]],
          ['Possible matches', NOTIFICATION_LABELS[s.uncertainNotifications]],
          ['Poll every', pollEvery(s.pollEvery)],
        ]}
        onEdit={undefined}
      />
    </Unboxed>
  );
}

function priceRange({ min, max }: WantedSpec['settings']['priceRange']): string {
  if (min === null && max === null) return 'Any price';
  if (min === null) return `Up to £${max}`;
  if (max === null) return `£${min} or more`;
  return `£${min} to £${max}`;
}

function SettingsGroup({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: [string, string][];
  onEdit: (() => void) | undefined;
}) {
  // No visible subtitle: the button names the group, and the section keeps it for a screen reader.
  return (
    <section aria-label={title}>
      {onEdit ? (
        <div className="mb-3 flex min-h-8 items-center justify-end">
          <PanelAction kind="edit" label={`Edit ${title}`} onClick={onEdit} />
        </div>
      ) : null}
      <dl className="grid gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-x-4 text-sm">
            <dt className="text-ink-dim dark:text-ink-dim-dark">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The interval as it will run: hours, rounded up as the scheduler rounds them. */
function pollEvery(duration: string | null): string {
  if (duration === null) return '8 hours (the default)';
  const hours = durationToHours(duration);
  if (hours === undefined) return duration;
  const runs = scheduledHours(hours);
  const period = `${runs} hour${runs === 1 ? '' : 's'}`;
  return runs === hours ? period : `${period} (${hours} asked for)`;
}

/**
 * The criteria in two groups, hard then soft (P1-30): what failing one does is the first thing to
 * know about a criterion, so it is the heading rather than a flag repeated on every row. Each
 * group keeps the spec's order.
 *
 * The warnings come from the whole spec, because `lintSpec` judges a criterion against the item's
 * settings as well as its own flags. `actions` draws each criterion's own controls beside it, and
 * is given the criterion's index in the spec, not in its group, since that is what an edit needs.
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
  const headingId = useId();

  if (criteria.length === 0) {
    return (
      <Card>
        <p className="text-sm">
          <Absent>Nothing is judged by reading or looking; the settings decide everything.</Absent>
        </p>
      </Card>
    );
  }

  const indexed = criteria.map((criterion, index) => ({ criterion, index }));
  return (
    <div className="space-y-8">
      {CRITERION_GROUPS.map((group) => {
        const members = indexed.filter((entry) => entry.criterion.kind === group.kind);
        if (members.length === 0) return null;
        return (
          <section key={group.kind} aria-labelledby={`${headingId}-${group.kind}`}>
            <div className="mt-3 flex items-center gap-1.5">
              <h3
                id={`${headingId}-${group.kind}`}
                className="text-xs font-medium uppercase tracking-wide text-ink-dim dark:text-ink-dim-dark"
              >
                {group.title}
              </h3>
              <HelpTip label={`What ${group.title.toLowerCase()} means`}>{group.help}</HelpTip>
            </div>
            <Card>
              <ul className="-my-3 divide-y divide-edge dark:divide-edge-dark">
                {members.map(({ criterion, index }) => (
                  <CriterionRow
                    key={criterion.id}
                    criterion={criterion}
                    warning={warnings.get(criterion.id)}
                    actions={actions ? actions(criterion, index) : null}
                  />
                ))}
              </ul>
            </Card>
            <ReadByLine reader="both" />
          </section>
        );
      })}
    </div>
  );
}

const CRITERION_GROUPS = [
  {
    kind: 'hard',
    title: 'Hard',
    help: 'A listing that fails any of these is rejected. This is Failure action: Reject.',
  },
  {
    kind: 'soft',
    title: 'Soft',
    help: 'A listing that fails one of these is marked uncertain, so you still see it. This is Failure action: Uncertain.',
  },
] as const;

function CriterionRow({
  criterion,
  warning,
  actions,
}: {
  criterion: Criterion;
  warning: string | undefined;
  actions: ReactNode;
}) {
  return (
    <li className="flex items-start gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <CriterionText text={criterion.text} />
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <CriterionFlags
            kind={criterion.kind}
            onUnknown={criterion.onUnknown}
            quantifiable={criterion.quantifiable}
            showFailure={false}
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
        {warning ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">{warning}</p>
        ) : null}
      </div>
      {actions ? (
        // Lowered to centre on the criterion's box, which is taller than the buttons.
        <div className="mt-1 flex shrink-0 gap-1">{actions}</div>
      ) : null}
    </li>
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

  const body = `${PROMPT_INLINE} text-ink/85 dark:text-ink-dark/85 ${open ? 'whitespace-pre-wrap' : 'truncate'}`;
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
