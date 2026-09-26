import type {
  BackfillDepth,
  BuyingType,
  ConditionCategory,
  CriterionKind,
  MarketplaceSourceId,
  NotificationMode,
  OnUnknown,
  RelistPolicy,
  ShipsToUkPolicy,
  SourceId,
  SpecWarning,
  WantedSpec,
} from '@goodies-beacon/core/schemas';
import {
  BACKFILL_DEPTHS,
  BUYING_TYPES,
  CONDITION_CATEGORIES,
  CRITERION_KINDS,
  durationToHours,
  hoursToDuration,
  isMarketplaceSourceId,
  NOTIFICATION_MODES,
  ON_UNKNOWN,
  RELIST_POLICIES,
  SHIPS_TO_UK_POLICIES,
  scheduledHours,
} from '@goodies-beacon/core/schemas';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Button, CONTROL, Field } from '../components/form.js';
import {
  BACKFILL_DEPTH_LABELS,
  CONDITION_LABELS,
  isOffered,
  LISTING_TYPE_LABELS,
  NOTIFICATION_LABELS,
  OFFERED_SOURCES,
  ON_UNKNOWN_LABELS,
  RELIST_LABELS,
  SHIPS_TO_UK_LABELS,
  SOURCE_LABELS,
  sourceLabel,
} from './labels.js';
import { type SpecDocument, type SpecIssue, withDocument, withSetting } from './parse.js';

export type SpecFormPart = 'describe' | 'settings' | 'criteria' | 'searchPlans';

const ALL_PARTS: readonly SpecFormPart[] = ['describe', 'settings', 'criteria', 'searchPlans'];

/**
 * The typed editing surface for a spec (P1-18), beside the JSON editor rather than instead of it.
 *
 * §4's settings/criteria split is the shape of the page: everything with a bounded set of values
 * is a control, and the two tables hold the things that need writing in English. Reads come from
 * `spec`, which the schema has normalised, and writes go to the raw document through `parse.ts`
 * — see `withDocument` for why the two are not the same object.
 *
 * `parts` narrows it to what one of the item page's section editors changes (P1-24). A single
 * part drops its own heading, because the modal around it already says what it is.
 */
export function SpecForm({
  spec,
  text,
  onChange,
  warnings,
  issues,
  parts = ALL_PARTS,
}: {
  spec: WantedSpec;
  text: string;
  onChange: (text: string) => void;
  warnings: SpecWarning[];
  /** The strict schema's objections, shown beside the field each one names. */
  issues: readonly SpecIssue[];
  parts?: readonly SpecFormPart[];
}) {
  const edit = (mutate: (document: SpecDocument) => void) => {
    const updated = withDocument(text, mutate);
    if (updated !== undefined) onChange(updated);
  };

  const setting = (key: string, value: unknown) => {
    const updated = withSetting(text, key, value);
    if (updated !== undefined) onChange(updated);
  };

  const errors: Errors = (path) => issues.find((issue) => issue.path === path)?.message;

  const titled = parts.length > 1;

  return (
    <div className="space-y-8">
      {parts.includes('describe') ? <Describe spec={spec} edit={edit} titled={titled} /> : null}
      {parts.includes('settings') ? (
        <Settings spec={spec} setting={setting} errors={errors} titled={titled} />
      ) : null}
      {parts.includes('criteria') ? (
        <Criteria spec={spec} edit={edit} warnings={warnings} errors={errors} titled={titled} />
      ) : null}
      {parts.includes('searchPlans') ? (
        <SearchPlans spec={spec} edit={edit} errors={errors} titled={titled} />
      ) : null}
    </div>
  );
}

type Edit = (mutate: (document: SpecDocument) => void) => void;
type Setting = (key: string, value: unknown) => void;
type Errors = (path: string) => string | undefined;

/** Merges `patch` into row `index` of one of the document's arrays, if both are there to edit. */
function patchRow(
  edit: Edit,
  key: 'criteria' | 'searchPlans',
  index: number,
  patch: Record<string, unknown>,
) {
  edit((document) => {
    const list = document[key];
    if (!Array.isArray(list)) return;
    const row = list[index];
    if (row === null || typeof row !== 'object') return;
    Object.assign(row, patch);
  });
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
      {message}
    </p>
  ) : null;
}

function Group({
  title,
  titled,
  hint,
  children,
}: {
  title: string;
  titled: boolean;
  hint?: string;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={titled ? headingId : undefined}
      aria-label={titled ? undefined : title}
    >
      {titled ? (
        <h3 id={headingId} className="mb-1 text-sm font-medium">
          {title}
        </h3>
      ) : null}
      {hint ? <p className="text-xs text-ink-dim dark:text-ink-dim-dark">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A `select` over one of §4's bounded tuples, which is most of the settings. */
function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onPick,
  labels,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly T[];
  onPick: (value: T) => void;
  labels?: Record<string, string>;
}) {
  const id = useId();

  return (
    <Field id={id} label={label} hint={hint}>
      <select
        id={id}
        value={value}
        onChange={(event) => onPick(event.target.value as T)}
        className={CONTROL}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Check({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        className="size-4 rounded border-edge dark:border-edge-dark"
      />
      {label}
    </label>
  );
}

function Describe({ spec, edit, titled }: { spec: WantedSpec; edit: Edit; titled: boolean }) {
  const ids = { summary: useId(), note: useId() };

  return (
    <Group title="What you are looking for" titled={titled}>
      <div className="space-y-5">
        <Field
          id={ids.summary}
          label="Summary"
          hint="Shown to the pre-filter and the reviewer as context. One or two sentences."
        >
          <textarea
            id={ids.summary}
            rows={3}
            value={spec.summary}
            onChange={(event) =>
              edit((document) => {
                document.summary = event.target.value;
              })
            }
            className={CONTROL}
          />
        </Field>

        <Field
          id={ids.note}
          label="How sellers list this"
          hint="Given to the pre-filter alone: how titles are written, what looks plausible, what plainly is not. Worth more than any other field when the name is a common phrase."
        >
          <textarea
            id={ids.note}
            rows={4}
            value={spec.plausibilityNote ?? ''}
            onChange={(event) =>
              edit((document) => {
                document.plausibilityNote = event.target.value === '' ? null : event.target.value;
              })
            }
            className={CONTROL}
          />
        </Field>
      </div>
    </Group>
  );
}

function Settings({
  spec,
  setting,
  errors,
  titled,
}: {
  spec: WantedSpec;
  setting: Setting;
  errors: Errors;
  titled: boolean;
}) {
  const s = spec.settings;
  const ids = { price: useId() };
  // Only the marketplaces there is an adapter for, plus any the spec already names so nothing is
  // switched on out of sight. Grading waits for Phase 5 and is not shown at all (P1-26).
  const sources = [...OFFERED_SOURCES, ...s.sources.filter((source) => !isOffered(source))];

  const toggleIn = <T extends string>(list: readonly T[], value: T, on: boolean): T[] =>
    on ? [...list, value] : list.filter((entry) => entry !== value);

  return (
    <Group title="Settings" titled={titled} hint="Everything with a bounded set of values (§4).">
      <div className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <span className="block text-sm font-medium">Marketplaces</span>
            <div className="mt-2 space-y-1.5">
              {sources.map((source) => (
                <Check
                  key={source}
                  label={sourceLabel(source)}
                  checked={s.sources.includes(source)}
                  onToggle={(on) => setting('sources', toggleIn<SourceId>(s.sources, source, on))}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-dim dark:text-ink-dim-dark">
              The others arrive with their adapters in Phase 4.
            </p>
          </div>

          <div>
            <span className="block text-sm font-medium">Listing types</span>
            <div className="mt-2 space-y-1.5">
              {BUYING_TYPES.map((type) => (
                <Check
                  key={type}
                  label={LISTING_TYPE_LABELS[type]}
                  checked={s.listingTypes.includes(type)}
                  onToggle={(on) =>
                    setting('listingTypes', toggleIn<BuyingType>(s.listingTypes, type, on))
                  }
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-dim dark:text-ink-dim-dark">
              At least one. Dropping auctions hides a great deal of vintage stock.
            </p>
            <FieldError message={errors('settings.listingTypes')} />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={ids.price}
            label="Price ceiling"
            hint="In GBP; every other currency is converted before comparing. Empty means any price."
            error={errors('settings.priceCeiling.amount')}
          >
            <input
              id={ids.price}
              type="number"
              step="any"
              value={s.priceCeiling ? s.priceCeiling.amount : ''}
              placeholder="any price"
              onChange={(event) =>
                setting(
                  'priceCeiling',
                  event.target.value === ''
                    ? null
                    : { amount: Number(event.target.value), currency: 'GBP' },
                )
              }
              className={CONTROL}
            />
          </Field>

          <Keywords
            value={s.negativeKeywords}
            onChange={(keywords) => setting('negativeKeywords', keywords)}
            error={errors('settings.negativeKeywords')}
          />

          <PollHours
            value={s.pollEvery}
            onChange={(pollEvery) => setting('pollEvery', pollEvery)}
            error={errors('settings.pollEvery')}
          />

          <Choice
            label="Notifications"
            hint="Real-time emails on sight; digest waits for the 08:00 round-up."
            value={s.notificationMode}
            options={NOTIFICATION_MODES}
            onPick={(value: NotificationMode) => setting('notificationMode', value)}
            labels={NOTIFICATION_LABELS}
          />

          <Choice
            label="Relists"
            value={s.relists}
            options={RELIST_POLICIES}
            onPick={(value: RelistPolicy) => setting('relists', value)}
            labels={RELIST_LABELS}
          />

          <Choice
            label="When a criterion cannot be settled"
            hint="The default each criterion starts from."
            value={s.defaultOnUnknown}
            options={ON_UNKNOWN}
            onPick={(value: OnUnknown) => setting('defaultOnUnknown', value)}
            labels={ON_UNKNOWN_LABELS}
          />

          <Choice
            label="Condition"
            value={s.conditionCategory}
            options={CONDITION_CATEGORIES}
            onPick={(value: ConditionCategory) => setting('conditionCategory', value)}
            labels={CONDITION_LABELS}
          />

          <Choice
            label="Shipping to the UK"
            hint="§1 shows the flag rather than filtering on it."
            value={s.shipsToUk}
            options={SHIPS_TO_UK_POLICIES}
            onPick={(value: ShipsToUkPolicy) => setting('shipsToUk', value)}
            labels={SHIPS_TO_UK_LABELS}
          />
        </div>

        <div className="rounded-lg border border-edge p-4 dark:border-edge-dark">
          <Check
            label="Sweep what is already listed when this item is first polled"
            checked={s.backfill.enabled}
            onToggle={(on) => setting('backfill', { ...s.backfill, enabled: on })}
          />
          <div className="mt-3 max-w-xs">
            <Choice
              label="How far back"
              value={s.backfill.depth}
              options={BACKFILL_DEPTHS}
              onPick={(value: BackfillDepth) =>
                setting('backfill', { ...s.backfill, depth: value })
              }
              labels={BACKFILL_DEPTH_LABELS}
            />
          </div>
          <p className="mt-2 text-xs text-ink-dim dark:text-ink-dim-dark">
            A backfill reaches the item page and one summary email, never a real-time email — but it
            is pre-filter calls, so set the budget cap before turning it on.
          </p>
        </div>
      </div>
    </Group>
  );
}

/**
 * The poll interval in whole hours (P1-26). The spec stores an ISO 8601 duration, which is what the
 * scheduler reads, so hours are converted on the way in and out; the scheduler then rounds up to a
 * period cron can express, and the hint says what that will be rather than leaving it to surprise.
 * A stored value that is not whole hours — a hand-written PT90M — is left alone and named, not
 * rounded away. Holds its own text while typed, as Keywords does, so an empty box stays empty.
 */
function PollHours({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (pollEvery: string | null) => void;
  error: string | undefined;
}) {
  const id = useId();
  const stored = value === null ? undefined : durationToHours(value);
  const [typed, setTyped] = useState(stored === undefined ? '' : String(stored));
  const hours = Number(typed);
  const whole = typed !== '' && Number.isInteger(hours) && hours >= 1;
  const runs = whole ? scheduledHours(hours) : undefined;

  const hint =
    value !== null && stored === undefined
      ? `Currently ${value}, which is not whole hours; typing a number replaces it.`
      : typed === ''
        ? 'Empty uses the instance default: every 8 hours.'
        : !whole
          ? 'Whole hours, 1 or more.'
          : runs !== hours
            ? `A schedule cannot divide the day into ${hours}s, so this polls every ${runs} hours.`
            : `Polls every ${hours} hour${hours === 1 ? '' : 's'}.`;

  return (
    <Field id={id} label="Poll every (hours)" hint={hint} error={error}>
      <input
        id={id}
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        value={typed}
        placeholder="8 (the default)"
        onChange={(event) => {
          const text = event.target.value;
          setTyped(text);
          const next = Number(text);
          if (text === '') onChange(null);
          else if (Number.isInteger(next) && next >= 1) onChange(hoursToDuration(next));
        }}
        className={CONTROL}
      />
    </Field>
  );
}

/**
 * Negative keywords, as a comma-separated line.
 *
 * It holds its own text while being typed rather than re-deriving it from the array on every
 * keystroke: splitting and re-joining as you type eats the comma and the space after it the
 * moment they are entered.
 */
function Keywords({
  value,
  onChange,
  error,
}: {
  value: readonly string[];
  onChange: (keywords: string[]) => void;
  error: string | undefined;
}) {
  const id = useId();
  const [typed, setTyped] = useState(value.join(', '));

  useEffect(() => {
    const parsed = typed
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word !== '');
    if (parsed.join(' ') !== value.join(' ')) setTyped(value.join(', '));
  }, [value, typed]);

  return (
    <Field
      id={id}
      label="Negative keywords"
      hint="Comma separated. A title containing one is rejected before any model is called — free, but nothing judges it, so a word that can appear in a listing you want will lose it silently."
      error={error}
    >
      <input
        id={id}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange(
            event.target.value
              .split(',')
              .map((word) => word.trim())
              .filter((word) => word !== ''),
          );
        }}
        className={CONTROL}
      />
    </Field>
  );
}

/**
 * A new criterion's id: stable from the moment it is added, because §4 keys feedback on it.
 *
 * Random rather than counted. A counter only avoids the ids in the spec on screen, so deleting
 * `criterion-4`, saving, and adding another would hand the newcomer the old one's feedback.
 */
function newCriterionId(taken: readonly { id: string }[]): string {
  const used = new Set(taken.map((entry) => entry.id));
  for (;;) {
    const candidate = `criterion-${crypto.randomUUID().slice(0, 8)}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * A new plan's id. A whole uuid, because `search_plan_state` is keyed on the plan id alone across
 * every item: two items whose plans were both called `plan-1` would share one watermark.
 */
function newPlanId(): string {
  return `plan-${crypto.randomUUID()}`;
}

/** Where a new plan searches until told otherwise, in each source's own vocabulary (§4). */
const DEFAULT_REGION: Record<MarketplaceSourceId, string> = {
  ebay: 'EBAY_GB',
  vinted: 'vinted.co.uk',
  yahoo_auctions_jp: 'jp',
  mercari_jp: 'jp',
};

function Row({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <li className="rounded-lg border border-edge p-4 dark:border-edge-dark">
      {children}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-600 hover:underline dark:text-red-400"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function Criteria({
  spec,
  edit,
  warnings,
  errors,
  titled,
}: {
  spec: WantedSpec;
  edit: Edit;
  warnings: SpecWarning[];
  errors: Errors;
  titled: boolean;
}) {
  const warningFor = new Map(warnings.map((warning) => [warning.criterionId, warning.message]));

  const update = (index: number, key: string, value: unknown) =>
    patchRow(edit, 'criteria', index, { [key]: value });

  return (
    <Group
      title="Criteria"
      titled={titled}
      hint="Only judgement calls that need reading the description or looking at the photos. A price or a country belongs above, not here."
    >
      <ul className="space-y-3">
        {spec.criteria.map((criterion, index) => {
          const warning = warningFor.get(criterion.id);

          return (
            <Row
              key={criterion.id}
              onRemove={() =>
                edit((document) => {
                  if (Array.isArray(document.criteria)) document.criteria.splice(index, 1);
                })
              }
            >
              <p className="text-xs text-ink-dim dark:text-ink-dim-dark">
                <code className="font-mono">{criterion.id}</code> — kept across edits so feedback
                stays attached
              </p>

              <textarea
                aria-label={`Criterion ${index + 1}`}
                rows={2}
                value={criterion.text}
                onChange={(event) => update(index, 'text', event.target.value)}
                className={CONTROL}
              />
              <FieldError message={errors(`criteria.${index}.text`)} />

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Choice
                  label="Kind"
                  value={criterion.kind}
                  options={CRITERION_KINDS}
                  onPick={(value: CriterionKind) => update(index, 'kind', value)}
                  labels={{ hard: 'Hard — a fail rejects', soft: 'Soft — a fail is uncertain' }}
                />
                <Choice
                  label="When unknown"
                  value={criterion.onUnknown}
                  options={ON_UNKNOWN}
                  onPick={(value: OnUnknown) => update(index, 'onUnknown', value)}
                  labels={{ surface: 'Surface as uncertain', reject: 'Reject' }}
                />
                <div className="flex items-end pb-2">
                  <Check
                    label="Photos can settle it"
                    checked={criterion.quantifiable}
                    onToggle={(on) => update(index, 'quantifiable', on)}
                  />
                </div>
              </div>

              {warning ? (
                <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-500">
                  {warning}
                </p>
              ) : null}
            </Row>
          );
        })}
      </ul>

      <div className="mt-3">
        <Button
          type="button"
          variant="quiet"
          onClick={() =>
            edit((document) => {
              const list = Array.isArray(document.criteria) ? document.criteria : [];
              document.criteria = [
                ...list,
                {
                  id: newCriterionId(spec.criteria),
                  text: '',
                  kind: 'soft',
                  quantifiable: false,
                  onUnknown: spec.settings.defaultOnUnknown,
                },
              ];
            })
          }
        >
          Add a Criterion
        </Button>
      </div>
    </Group>
  );
}

function SearchPlans({
  spec,
  edit,
  errors,
  titled,
}: {
  spec: WantedSpec;
  edit: Edit;
  errors: Errors;
  titled: boolean;
}) {
  const source = spec.settings.sources.find(isMarketplaceSourceId) ?? 'ebay';

  return (
    <Group
      title="Search plans"
      titled={titled}
      hint="Search broad, judge narrow (§1). Several plain queries beat one clever one, and overlapping plans cost nothing — a listing found twice becomes one candidate and is reviewed once."
    >
      <ul className="space-y-3">
        {spec.searchPlans.map((plan, index) => (
          <PlanRow key={plan.id} plan={plan} index={index} edit={edit} errors={errors} />
        ))}
      </ul>

      <div className="mt-3">
        <Button
          type="button"
          variant="quiet"
          onClick={() =>
            edit((document) => {
              const list = Array.isArray(document.searchPlans) ? document.searchPlans : [];
              document.searchPlans = [
                ...list,
                {
                  id: newPlanId(),
                  source,
                  query: '',
                  region: DEFAULT_REGION[source],
                  options: {},
                  enabled: true,
                  watermark: null,
                },
              ];
            })
          }
        >
          Add a Search Plan
        </Button>
      </div>
    </Group>
  );
}

function PlanRow({
  plan,
  index,
  edit,
  errors,
}: {
  plan: WantedSpec['searchPlans'][number];
  index: number;
  edit: Edit;
  errors: Errors;
}) {
  const ids = { query: useId(), region: useId() };
  const update = (patch: Record<string, unknown>) => patchRow(edit, 'searchPlans', index, patch);

  // A plan on a source no marketplace owns (the template adapter's) keeps its own value in the
  // list, rather than the select quietly showing the first marketplace instead.
  const sources: readonly SourceId[] = isOffered(plan.source)
    ? OFFERED_SOURCES
    : [plan.source, ...OFFERED_SOURCES];

  return (
    <Row
      onRemove={() =>
        edit((document) => {
          if (Array.isArray(document.searchPlans)) document.searchPlans.splice(index, 1);
        })
      }
    >
      <p className="text-xs text-ink-dim dark:text-ink-dim-dark">
        <code className="font-mono">{plan.id}</code> — its stats on the item page are keyed on this
      </p>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Field
          id={ids.query}
          label="Query"
          hint="Exactly as sent to the source."
          error={errors(`searchPlans.${index}.query`)}
        >
          <input
            id={ids.query}
            value={plan.query}
            onChange={(event) => update({ query: event.target.value })}
            className={CONTROL}
          />
        </Field>

        <Field
          id={ids.region}
          label="Region"
          hint="The eBay marketplace to search: EBAY_GB, EBAY_US, EBAY_DE."
          error={errors(`searchPlans.${index}.region`)}
        >
          <input
            id={ids.region}
            value={plan.region}
            onChange={(event) => update({ region: event.target.value })}
            className={CONTROL}
          />
        </Field>

        <Choice
          label="Source"
          hint="Changing it starts a new plan: a new id, so no watermark or stats carry over from the old marketplace."
          value={plan.source}
          options={sources}
          labels={SOURCE_LABELS}
          onPick={(value: SourceId) => {
            if (!isMarketplaceSourceId(value)) return;
            update({
              id: newPlanId(),
              source: value,
              region: DEFAULT_REGION[value],
              options: {},
              watermark: null,
            });
          }}
        />

        <div className="flex items-end pb-2">
          <Check label="Polled" checked={plan.enabled} onToggle={(on) => update({ enabled: on })} />
        </div>
      </div>
    </Row>
  );
}
