import type {
  BuyingType,
  ConditionCategory,
  CountryCode,
  Criterion,
  CriterionKind,
  MarketplaceSourceId,
  NotificationMode,
  OnUnknown,
  RelistPolicy,
  SearchPlan,
  ShipsToUkPolicy,
  SourceId,
  SpecWarning,
  WantedSpec,
} from '@goodies-beacon/core/schemas';
import {
  BUYING_TYPES,
  CONDITION_CATEGORIES,
  COUNTRY_CODES,
  CRITERION_KINDS,
  countryName,
  durationToHours,
  hoursToDuration,
  isMarketplaceSourceId,
  linkedCriterion,
  NOTIFICATION_MODES,
  ON_UNKNOWN,
  RELIST_POLICIES,
  SELLER_COUNTRY_OPTION,
  SHIPS_TO_UK_POLICIES,
  SOURCE_REGIONS,
  scheduledHours,
} from '@goodies-beacon/core/schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { sharedCriteriaQuery } from '../api/criteria.js';
import { CountryPicker } from '../components/country-picker.js';
import { Button, CONTROL, Field } from '../components/form.js';
import { PROMPT_CONTROL, PROMPT_INLINE, ReadByLine } from '../components/prompt-text.js';
import { SharedCriterionPicker } from '../criteria/picker.js';
import {
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
import {
  type SpecDocument,
  type SpecIssue,
  withDocument,
  withSetting,
  withSettings,
} from './parse.js';

export type SpecFormPart =
  | 'describe'
  | 'marketplaceSettings'
  | 'generalSettings'
  | 'criterion'
  | 'searchPlan';

/**
 * Which criterion or search plan the `criterion` and `searchPlan` parts edit, and whether it is the
 * one being added. Both are edited one at a time (P1-27): a form holding every one of them was
 * overwhelming past a handful.
 */
export interface EntryFocus {
  index: number;
  adding: boolean;
}

const ALL_PARTS: readonly SpecFormPart[] = ['describe', 'marketplaceSettings', 'generalSettings'];

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
  focus,
}: {
  spec: WantedSpec;
  text: string;
  onChange: (text: string) => void;
  warnings: SpecWarning[];
  /** The strict schema's objections, shown beside the field each one names. */
  issues: readonly SpecIssue[];
  parts?: readonly SpecFormPart[];
  /** Required by the `criterion` and `searchPlan` parts. */
  focus?: EntryFocus | undefined;
}) {
  const edit = (mutate: (document: SpecDocument) => void) => {
    const updated = withDocument(text, mutate);
    if (updated !== undefined) onChange(updated);
  };

  const setting = (key: string, value: unknown) => {
    const updated = withSetting(text, key, value);
    if (updated !== undefined) onChange(updated);
  };

  const patchSettings = (patch: Record<string, unknown>) => {
    const updated = withSettings(text, patch);
    if (updated !== undefined) onChange(updated);
  };

  const errors: Errors = (path) => issues.find((issue) => issue.path === path)?.message;

  const titled = parts.length > 1;

  return (
    <div className="space-y-8">
      {parts.includes('describe') ? <Describe spec={spec} edit={edit} titled={titled} /> : null}
      {parts.includes('marketplaceSettings') ? (
        <MarketplaceSettings
          spec={spec}
          setting={setting}
          patchSettings={patchSettings}
          errors={errors}
          titled={titled}
        />
      ) : null}
      {parts.includes('generalSettings') ? (
        <GeneralSettings spec={spec} setting={setting} errors={errors} titled={titled} />
      ) : null}
      {parts.includes('criterion') && focus ? (
        <CriterionFields
          spec={spec}
          edit={edit}
          warnings={warnings}
          errors={errors}
          focus={focus}
        />
      ) : null}
      {parts.includes('searchPlan') && focus ? (
        <SearchPlanFields spec={spec} edit={edit} errors={errors} focus={focus} />
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
  disabled = false,
}: {
  label: string;
  hint?: string | undefined;
  value: T;
  options: readonly T[];
  onPick: (value: T) => void;
  labels?: Record<string, string>;
  disabled?: boolean;
}) {
  const id = useId();

  return (
    <Field id={id} label={label} hint={hint}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onPick(event.target.value as T)}
        className={`${CONTROL} disabled:opacity-60`}
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

/**
 * A checkbox in a grid of fields, level with the controls beside it rather than their hints: past a
 * `Field`'s label and its control's top margin, then centred on the control's height. Pinned to the
 * cell's foot, it dropped below the controls whenever a hint beside it wrapped.
 */
const BESIDE_CONTROL = 'flex h-9.5 items-center sm:mt-7';

/** A select rather than a checkbox, so it reads as the shared criterion dialog's does beside it. */
const SETTLES = ['yes', 'no'] as const;

function Check({
  label,
  checked,
  onToggle,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
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
          reader="both"
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
            className={PROMPT_CONTROL}
          />
        </Field>

        <Field
          id={ids.note}
          label="How sellers list this"
          hint="Given to the pre-filter alone: how titles are written, what looks plausible, what plainly is not. Worth more than any other field when the name is a common phrase."
          reader="prefilter"
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
            className={PROMPT_CONTROL}
          />
        </Field>
      </div>
    </Group>
  );
}

/**
 * The settings in the item page's two groups (P1-28): what is asked of the marketplaces and how a
 * listing found there is filtered, and the rest — how much, how often, how you hear, and what an
 * unsettled criterion does — which is how the item behaves wherever it searches.
 */
function MarketplaceSettings({
  spec,
  setting,
  patchSettings,
  errors,
  titled,
}: {
  spec: WantedSpec;
  setting: Setting;
  patchSettings: (patch: Record<string, unknown>) => void;
  errors: Errors;
  titled: boolean;
}) {
  const s = spec.settings;
  // Only the marketplaces there is an adapter for, plus any the spec already names so nothing is
  // switched on out of sight. Grading waits for Phase 5 and is not shown at all (P1-26), nor is the
  // backfill sweep, which nothing acts on until then (P1-36).
  const sources = [...OFFERED_SOURCES, ...s.sources.filter((source) => !isOffered(source))];

  return (
    <Group title="Marketplace Settings" titled={titled}>
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
          <Keywords
            value={s.negativeKeywords}
            onChange={(keywords) => setting('negativeKeywords', keywords)}
            error={errors('settings.negativeKeywords')}
          />

          <Choice
            label="Relists"
            value={s.relists}
            options={RELIST_POLICIES}
            onPick={(value: RelistPolicy) => setting('relists', value)}
            labels={RELIST_LABELS}
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

        <div className="grid items-start gap-5 sm:grid-cols-2">
          <ItemSellerCountry
            value={s.sellerCountry}
            // Choosing one clears the exclusions: eBay then returns that country's sellers alone,
            // so a list of countries to drop would do nothing (P1-36).
            onChange={(code) =>
              patchSettings(
                code ? { sellerCountry: code, excludedCountries: [] } : { sellerCountry: null },
              )
            }
            error={errors('settings.sellerCountry')}
          />

          <ExcludedCountries
            value={s.excludedCountries}
            onChange={(codes) => setting('excludedCountries', codes)}
            error={errors('settings.excludedCountries')}
            only={s.sellerCountry}
          />
        </div>
      </div>
    </Group>
  );
}

function GeneralSettings({
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

  return (
    <Group title="General Settings" titled={titled}>
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
          label="When a criterion cannot be settled"
          hint="The default each criterion starts from."
          value={s.defaultOnUnknown}
          options={ON_UNKNOWN}
          onPick={(value: OnUnknown) => setting('defaultOnUnknown', value)}
          labels={ON_UNKNOWN_LABELS}
        />
      </div>
    </Group>
  );
}

const toggleIn = <T extends string>(list: readonly T[], value: T, on: boolean): T[] =>
  on ? [...list, value] : list.filter((entry) => entry !== value);

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
    if (parsed.join('\0') !== value.join('\0')) setTyped(value.join(', '));
  }, [value, typed]);

  return (
    <Field
      id={id}
      label="Negative keywords"
      hint="Comma separated. A title containing one is rejected before any model is called."
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

function ItemSellerCountry({
  value,
  onChange,
  error,
}: {
  value: CountryCode | null;
  onChange: (code: CountryCode | null) => void;
  error: string | undefined;
}) {
  const id = useId();

  return (
    <Field
      id={id}
      label="Only sellers located in"
      hint="Optional. Every eBay plan asks for sellers in this one country, unless the plan chooses its own; the rest are never fetched. Choosing one clears Exclude sellers located in, which it makes pointless."
      error={error}
    >
      <CountryPicker
        id={id}
        single
        chosenLabel="Item seller country"
        value={value ? [value] : []}
        onChange={([code]) => onChange(code ?? null)}
      />
    </Field>
  );
}

function ExcludedCountries({
  value,
  onChange,
  error,
  only,
}: {
  value: readonly CountryCode[];
  onChange: (codes: CountryCode[]) => void;
  error: string | undefined;
  /** The item's one seller country, which leaves nothing to exclude while it is set. */
  only: CountryCode | null;
}) {
  const id = useId();

  return (
    <Field
      id={id}
      label="Exclude sellers located in"
      hint="A seller in one of these countries is rejected before any model is called. It is where the seller is, not the item: an import sold from elsewhere still reaches the reviewer."
      error={error}
    >
      <CountryPicker
        id={id}
        value={value}
        onChange={onChange}
        chosenLabel="Excluded countries"
        disabled={only ? `Only ${countryName(only)} sellers are searched for` : undefined}
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

/**
 * One criterion, edited or being added, in a modal of its own. The list lives on the item page,
 * where each criterion has its own pencil; editing them all in one form was overwhelming past a
 * handful.
 */
function CriterionFields({
  spec,
  edit,
  warnings,
  errors,
  focus,
}: {
  spec: WantedSpec;
  edit: Edit;
  warnings: SpecWarning[];
  errors: Errors;
  focus: EntryFocus;
}) {
  const { index, adding } = focus;
  const criterion = spec.criteria[index];
  const shared = new Map(
    (useQuery(sharedCriteriaQuery).data?.criteria ?? []).map((row) => [row.key, row]),
  );
  const [picking, setPicking] = useState(false);
  if (!criterion) return null;

  const warning = warnings.find((each) => each.criterionId === criterion.id)?.message;
  const source = criterion.shared ? shared.get(criterion.shared) : undefined;
  // Until the shared criterion has loaded, nothing about a linked one is offered for editing:
  // the save would put back whatever it fixes anyway.
  const locked = (field: 'kind' | 'quantifiable' | 'onUnknown') =>
    criterion.shared !== undefined && (source === undefined || source[field] !== null);
  const lockedHint = (field: 'kind' | 'quantifiable' | 'onUnknown') =>
    locked(field) ? 'Set by the shared criterion.' : undefined;

  const update = (key: string, value: unknown) =>
    patchRow(edit, 'criteria', index, { [key]: value });
  const replace = (next: Criterion) =>
    edit((document) => {
      if (Array.isArray(document.criteria)) document.criteria[index] = next;
    });

  return (
    <div className="space-y-3">
      {criterion.shared ? (
        <>
          <p className="text-xs text-ink-dim dark:text-ink-dim-dark">
            Shared criterion <code className="font-mono">{criterion.shared}</code> — its text, and
            anything it sets, are edited on the{' '}
            <Link
              to="/criteria"
              search={{ q: criterion.shared }}
              className="text-beacon hover:underline"
            >
              Criteria
            </Link>{' '}
            page
          </p>
          <p className={`${PROMPT_INLINE} whitespace-pre-wrap`}>{source?.text ?? criterion.text}</p>
        </>
      ) : (
        <div>
          <p className="text-xs text-ink-dim dark:text-ink-dim-dark">
            Only a judgement call that needs reading the description or looking at the photos. A
            price or a country is a setting, not a criterion.
          </p>
          <textarea
            aria-label="Criterion"
            rows={3}
            value={criterion.text}
            onChange={(event) => update('text', event.target.value)}
            className={PROMPT_CONTROL}
          />
          <ReadByLine reader="both" />
          {/* An empty criterion is what every new one starts as, so it is not called an error. */}
          {criterion.text === '' ? null : <FieldError message={errors(`criteria.${index}.text`)} />}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Choice
          label="Failure action"
          hint={lockedHint('kind')}
          value={criterion.kind}
          options={CRITERION_KINDS}
          disabled={locked('kind')}
          onPick={(value: CriterionKind) => update('kind', value)}
          labels={{ hard: 'Reject', soft: 'Uncertain' }}
        />
        <Choice
          label="When unknown"
          hint={lockedHint('onUnknown')}
          value={criterion.onUnknown}
          options={ON_UNKNOWN}
          disabled={locked('onUnknown')}
          onPick={(value: OnUnknown) => update('onUnknown', value)}
          labels={ON_UNKNOWN_LABELS}
        />
        <Choice
          label="Photos can settle"
          hint={lockedHint('quantifiable')}
          value={criterion.quantifiable ? 'yes' : 'no'}
          options={SETTLES}
          disabled={locked('quantifiable')}
          onPick={(value) => update('quantifiable', value === 'yes')}
          labels={{ yes: 'Yes', no: 'No' }}
        />
      </div>

      {warning ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-500">
          {warning}
        </p>
      ) : null}

      {/* Adding, the new criterion can be one of the item's own or a shared one, either way. */}
      {adding && criterion.shared ? (
        <Button type="button" variant="quiet" onClick={() => replace(ownCriterion(spec, index))}>
          Write One of Its Own Instead
        </Button>
      ) : null}
      {adding && !criterion.shared ? (
        picking ? (
          <SharedCriterionPicker
            taken={new Set(spec.criteria.filter((_, at) => at !== index).map(({ id }) => id))}
            onPick={(row) => {
              replace(linkedCriterion(row, spec.settings.defaultOnUnknown));
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        ) : (
          <Button type="button" variant="quiet" onClick={() => setPicking(true)}>
            Use a Shared Criterion
          </Button>
        )
      ) : null}
    </div>
  );
}

/** A blank criterion of the item's own, where a new one starts. */
export function ownCriterion(spec: WantedSpec, index = spec.criteria.length): Criterion {
  return {
    id: newCriterionId(spec.criteria.filter((_, at) => at !== index)),
    text: '',
    kind: 'soft',
    quantifiable: false,
    onUnknown: spec.settings.defaultOnUnknown,
  };
}

/** A blank search plan on the item's first marketplace, where a new one starts. */
export function newSearchPlan(spec: WantedSpec): SearchPlan {
  const source = spec.settings.sources.find(isMarketplaceSourceId) ?? 'ebay';
  return {
    id: newPlanId(),
    source,
    query: '',
    region: DEFAULT_REGION[source],
    options: {},
    enabled: true,
    watermark: null,
  };
}

/** One search plan, edited or being added, in a modal of its own. */
function SearchPlanFields({
  spec,
  edit,
  errors,
  focus: { index, adding },
}: {
  spec: WantedSpec;
  edit: Edit;
  errors: Errors;
  focus: EntryFocus;
}) {
  const ids = { query: useId(), region: useId(), seller: useId() };
  const plan = spec.searchPlans[index];
  const [stored] = useState(
    () => plan && { id: plan.id, source: plan.source, region: plan.region },
  );
  if (!plan) return null;

  // A plan's watermark, stats and schedule are its query's history on one site, keyed by its id, so
  // a new site starts a new plan as a new source does (P1-29). Choosing the stored site again before
  // saving gives the old id back, so a change that comes to nothing loses nothing.
  const pickRegion = (region: string) => {
    if (adding || !stored) return update({ region });
    const same = region === stored.region && plan.source === stored.source;
    update({ region, id: same ? stored.id : newPlanId() });
  };

  const update = (patch: Record<string, unknown>) => patchRow(edit, 'searchPlans', index, patch);
  const regions = SOURCE_REGIONS[plan.source];
  // Kept on the plan's id when changed, unlike the region: the plan searches the same site, and
  // its watermark is a time, which a narrower search leaves as true as it was.
  const sellerKey = SELLER_COUNTRY_OPTION[plan.source];
  const storedCountry = sellerKey ? plan.options[sellerKey] : undefined;
  const sellerCountry = (COUNTRY_CODES as readonly unknown[]).includes(storedCountry)
    ? (storedCountry as CountryCode)
    : null;

  // A plan on a source no marketplace owns (the template adapter's) keeps its own value in the
  // list, rather than the select quietly showing the first marketplace instead.
  const sources: readonly SourceId[] = isOffered(plan.source)
    ? OFFERED_SOURCES
    : [plan.source, ...OFFERED_SOURCES];

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-dim dark:text-ink-dim-dark">
        Search broad, judge narrow (§1). Several plain queries beat one clever one, and overlapping
        plans cost nothing — a listing found twice becomes one candidate and is reviewed once.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={ids.query}
          label="Query"
          hint="Exactly as sent to the source."
          // A new plan starts without a query, which is not yet a fault.
          error={plan.query === '' ? undefined : errors(`searchPlans.${index}.query`)}
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
          hint={
            regions
              ? `The ${sourceLabel(plan.source)} site to search. Changing it starts the plan's stats afresh; to search several sites, add a plan for each.`
              : 'Where to search, in the source’s own terms.'
          }
          error={errors(`searchPlans.${index}.region`)}
        >
          {regions ? (
            <select
              id={ids.region}
              value={plan.region}
              onChange={(event) => pickRegion(event.target.value)}
              className={CONTROL}
            >
              {/* A region saved before the list was enforced (P1-29) shows as itself, to be changed. */}
              {regions.some(({ value }) => value === plan.region) ? null : (
                <option value={plan.region}>
                  {plan.region} — not a {sourceLabel(plan.source)} site
                </option>
              )}
              {regions.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={ids.region}
              value={plan.region}
              onChange={(event) => pickRegion(event.target.value)}
              className={CONTROL}
            />
          )}
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

        <div className={BESIDE_CONTROL}>
          <Check label="Polled" checked={plan.enabled} onToggle={(on) => update({ enabled: on })} />
        </div>
      </div>

      {sellerKey ? (
        <Field
          id={ids.seller}
          label="Only sellers located in"
          hint={`${
            spec.settings.sellerCountry && !sellerCountry
              ? `Empty, so it uses the item's: ${countryName(spec.settings.sellerCountry)}, from Marketplace Settings. Choose one here for this plan alone.`
              : 'Optional; the item’s Marketplace Settings can set one for every plan.'
          } ${sourceLabel(plan.source)} is asked for sellers in this country only, so the rest never arrive and nothing records them. One country per plan: for two, add a plan for each.`}
          error={errors(`searchPlans.${index}.options.${sellerKey}`)}
        >
          <CountryPicker
            id={ids.seller}
            single
            chosenLabel="Seller country"
            value={sellerCountry ? [sellerCountry] : []}
            onChange={([code]) => {
              const { [sellerKey]: _dropped, ...rest } = plan.options;
              update({ options: code ? { ...rest, [sellerKey]: code } : rest });
            }}
          />
        </Field>
      ) : null}
    </div>
  );
}
