import type {
  CriterionKind,
  OnUnknown,
  SharedCriterionCreateInput,
} from '@goodies-beacon/core/schemas';
import {
  joinTags,
  lintCriterion,
  matchesSharedCriterion,
  ON_UNKNOWN,
  sharedCriterionCreateSchema,
  splitTags,
} from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import {
  createSharedCriterion,
  deleteSharedCriterion,
  refreshSharedCriteria,
  type SharedCriterionRow,
  sharedCriteriaQuery,
  updateSharedCriterion,
} from '../api/criteria.js';
import { CriterionFlags } from '../components/criterion-flags.js';
import { Alert, Button, CONTROL, Field, NO_AUTOFILL } from '../components/form.js';
import { IconButton } from '../components/icon-button.js';
import { EditIcon, RemoveIcon } from '../components/icons.js';
import { Modal } from '../components/modal.js';
import { PROMPT_CONTROL, PROMPT_INLINE } from '../components/prompt-text.js';
import { TagPills } from '../components/tag-pills.js';
import { toast } from '../components/toasts.js';
import { ON_UNKNOWN_LABELS } from '../items/labels.js';
import { appLayoutRoute } from './app-layout.js';

export interface CriteriaSearch {
  /** Part of an identifier or a tag, matched ignoring case. */
  q?: string | undefined;
}

export const criteriaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/criteria',
  validateSearch: (search: Record<string, unknown>): CriteriaSearch => ({
    // The router reads `?q=1990` as a number.
    q: queryParam(typeof search.q === 'number' ? String(search.q) : search.q),
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(sharedCriteriaQuery),
  component: Criteria,
});

/**
 * Shared criteria (P1-27): a criterion written once — "the original release, not the Nintendo
 * Classics re-release" — and added to any wanted item by its identifier. Saving one writes a new
 * version on every item that uses it, and deleting one leaves each item its copy.
 */
function Criteria() {
  const { q } = criteriaRoute.useSearch();
  const navigate = useNavigate({ from: '/criteria' });
  const { data, isPending, isError } = useQuery(sharedCriteriaQuery);
  const criteria = data?.criteria ?? [];
  // Driven by its own state and copied to the URL, as the wish list's tag box is (P1-21).
  const [query, setQuery] = useState(q ?? '');
  const shown = criteria.filter((criterion) => matchesSharedCriterion(criterion, query));
  // `null` is closed; an empty object is adding, and one holding a criterion is editing it.
  const [editing, setEditing] = useState<{ criterion?: SharedCriterionRow } | null>(null);

  const filterBy = (value: string) => {
    setQuery(value);
    void navigate({ search: { q: queryParam(value) }, replace: true });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Shared Criteria</h1>
        <Button type="button" aria-label="Create a shared criterion" onClick={() => setEditing({})}>
          Create
        </Button>
      </div>
      <p className="mt-4 text-sm text-ink-dim dark:text-ink-dim-dark">
        Written once and added to any wanted item by its identifier. Saving one updates every item
        that uses it, as a new version.
      </p>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        wide
        title={editing?.criterion ? `Edit ${editing.criterion.key}` : 'Create a Shared Criterion'}
      >
        {/* Mounted only while open, so each opening starts fresh (see the wish list's modal). */}
        {editing !== null ? (
          <CriterionForm
            key={editing.criterion?.id}
            criterion={editing.criterion}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Modal>

      <div className="mt-4">
        <input
          type="search"
          aria-label="Filter by identifier or tag"
          placeholder="Filter by identifier or tag…"
          value={query}
          onChange={(event) => filterBy(event.target.value)}
          className={CONTROL}
        />
      </div>

      {isPending ? (
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? <Alert tone="error">Could not load the shared criteria.</Alert> : null}

      {data && shown.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-edge p-8 text-center dark:border-edge-dark">
          <p className="text-sm text-ink-dim dark:text-ink-dim-dark">
            {query.trim() ? `Nothing matches “${query.trim()}”.` : 'No shared criteria yet.'}
          </p>
        </div>
      ) : null}

      {shown.length > 0 ? (
        <ul
          aria-label="Shared criteria"
          className="mt-4 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark"
        >
          {shown.map((criterion) => (
            <li key={criterion.id} className="p-4">
              <CriterionEntry
                criterion={criterion}
                onEdit={() => setEditing({ criterion })}
                onPickTag={filterBy}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CriterionEntry({
  criterion,
  onEdit,
  onPickTag,
}: {
  criterion: SharedCriterionRow;
  onEdit: () => void;
  onPickTag: (tag: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteSharedCriterion(criterion.id),
    onSuccess: async () => {
      await refreshSharedCriteria(queryClient);
      toast.ok(`Deleted ${criterion.key}.`);
    },
    onError: () => toast.error(`Could not delete ${criterion.key}.`),
  });

  return (
    <div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-mono text-sm font-medium break-all">{criterion.key}</p>
            <TagPills tags={criterion.tags} onPick={onPickTag} />
          </div>
          <p className={`mt-3 ${PROMPT_INLINE} whitespace-pre-wrap`}>{criterion.text}</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <CriterionFlags
              kind={criterion.kind}
              onUnknown={criterion.onUnknown}
              quantifiable={criterion.quantifiable}
            />
          </p>
          <p className="mt-2.5 text-xs text-ink-dim dark:text-ink-dim-dark">{usage(criterion)}</p>
        </div>
        <div className="flex gap-2">
          <IconButton label={`Edit ${criterion.key}`} onClick={onEdit}>
            <EditIcon />
          </IconButton>
          <IconButton
            label={`Delete ${criterion.key}`}
            tone="danger"
            onClick={() => setConfirming(true)}
          >
            <RemoveIcon />
          </IconButton>
        </div>
      </div>

      {confirming ? (
        <div
          role="alertdialog"
          aria-label={`Delete ${criterion.key}`}
          className="mt-3 rounded-lg border border-edge p-3 text-sm dark:border-edge-dark"
        >
          <p>
            Delete {criterion.key}?{' '}
            {criterion.items > 0
              ? `${usage(criterion)}; each keeps it as a criterion of its own, in a new version.`
              : 'Nothing uses it.'}
          </p>
          <div className="mt-3 flex gap-3">
            <Button type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
            <Button type="button" variant="quiet" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {remove.isError ? <Alert tone="error">{(remove.error as Error).message}</Alert> : null}
    </div>
  );
}

/** What the form edits: '' is "each item chooses", and the tags are one comma-separated field. */
interface Values {
  key: string;
  text: string;
  kind: CriterionKind | '';
  quantifiable: 'yes' | 'no' | '';
  onUnknown: OnUnknown | '';
  tags: string;
}

const EMPTY: Values = { key: '', text: '', kind: '', quantifiable: '', onUnknown: '', tags: '' };

type Errors = Partial<Record<keyof Values, string>>;

const toSave = (values: Values): SharedCriterionCreateInput => ({
  key: values.key,
  text: values.text,
  kind: values.kind === '' ? null : values.kind,
  quantifiable: values.quantifiable === '' ? null : values.quantifiable === 'yes',
  onUnknown: values.onUnknown === '' ? null : values.onUnknown,
  tags: splitTags(values.tags),
});

function fromRow(criterion: SharedCriterionRow): Values {
  return {
    key: criterion.key,
    text: criterion.text,
    kind: criterion.kind ?? '',
    quantifiable: criterion.quantifiable === null ? '' : criterion.quantifiable ? 'yes' : 'no',
    onUnknown: criterion.onUnknown ?? '',
    tags: joinTags(criterion.tags),
  };
}

/** The same schema the server applies, so a bad identifier is named before anything is sent. */
function check(values: Values): Errors {
  const result = sharedCriterionCreateSchema.safeParse(toSave(values));
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof Values;
    errors[key] ??= issue.message;
  }
  return errors;
}

function CriterionForm({
  criterion,
  onDone,
  onCancel,
}: {
  criterion: SharedCriterionRow | undefined;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = {
    key: useId(),
    text: useId(),
    kind: useId(),
    quantifiable: useId(),
    onUnknown: useId(),
    tags: useId(),
  };
  const [values, setValues] = useState<Values>(() => (criterion ? fromRow(criterion) : EMPTY));
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({
    mutationFn: async (body: SharedCriterionCreateInput) => {
      if (!criterion) {
        await createSharedCriterion(body);
        return undefined;
      }
      const { key: _, ...fields } = body;
      const { updatedItems } = await updateSharedCriterion(criterion.id, fields);
      return updatedItems;
    },
    onSuccess: async (updatedItems, body) => {
      await refreshSharedCriteria(queryClient);
      onDone();
      toast.ok(
        !criterion
          ? `Created ${body.key}.`
          : updatedItems
            ? `Saved ${criterion.key}, and gave ${items(updatedItems)} a new version.`
            : `Saved ${criterion.key}.`,
      );
    },
    onError: () =>
      toast.error(
        criterion ? `Could not save ${criterion.key}.` : 'Could not create the criterion.',
      ),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const found = check(values);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate(toSave(values));
  };

  const [warning] =
    values.kind === 'hard' && values.quantifiable === 'no'
      ? lintCriterion({
          id: values.key,
          text: values.text,
          kind: 'hard',
          quantifiable: false,
          onUnknown: 'surface',
        })
      : [];

  return (
    <form noValidate onSubmit={onSubmit}>
      <div className="grid gap-4">
        <Field
          id={ids.key}
          label="Identifier"
          hint={
            criterion
              ? 'Fixed once created: it is how items find this criterion and what their feedback is kept against.'
              : 'How items find it, like original-release-not-classics. Fixed once created.'
          }
          error={errors.key}
        >
          <input
            id={ids.key}
            {...NO_AUTOFILL}
            value={values.key}
            disabled={criterion !== undefined}
            onChange={(event) => setValues({ ...values, key: event.target.value })}
            placeholder="original-release-not-classics"
            className={`${CONTROL} font-mono disabled:opacity-60`}
          />
        </Field>

        <Field id={ids.text} label="Criterion" error={errors.text} reader="both">
          <textarea
            id={ids.text}
            rows={3}
            value={values.text}
            onChange={(event) => setValues({ ...values, text: event.target.value })}
            placeholder="The original release in the standard box, not the Nintendo Classics re-release whose box has a red border"
            className={PROMPT_CONTROL}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id={ids.kind} label="Failure action">
            <select
              id={ids.kind}
              value={values.kind}
              onChange={(event) =>
                setValues({ ...values, kind: event.target.value as Values['kind'] })
              }
              className={CONTROL}
            >
              <option value="">Each item chooses</option>
              <option value="hard">Reject</option>
              <option value="soft">Uncertain</option>
            </select>
          </Field>
          <Field id={ids.onUnknown} label="When unknown">
            <select
              id={ids.onUnknown}
              value={values.onUnknown}
              onChange={(event) =>
                setValues({ ...values, onUnknown: event.target.value as Values['onUnknown'] })
              }
              className={CONTROL}
            >
              <option value="">Each item chooses</option>
              {ON_UNKNOWN.map((value) => (
                <option key={value} value={value}>
                  {ON_UNKNOWN_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={ids.quantifiable} label="Photos can settle">
            <select
              id={ids.quantifiable}
              value={values.quantifiable}
              onChange={(event) =>
                setValues({
                  ...values,
                  quantifiable: event.target.value as Values['quantifiable'],
                })
              }
              className={CONTROL}
            >
              <option value="">Each item chooses</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </div>
        {warning ? (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-500">
            This criterion {warning.message}.
          </p>
        ) : null}

        <Field
          id={ids.tags}
          label="Tags"
          hint="Optional. Words to find it by, separated by commas."
          error={errors.tags}
        >
          <input
            id={ids.tags}
            value={values.tags}
            onChange={(event) => setValues({ ...values, tags: event.target.value })}
            placeholder="game boy, boxed"
            className={CONTROL}
          />
        </Field>

        {criterion && criterion.items > 0 ? (
          <p className="text-xs text-ink-dim dark:text-ink-dim-dark">
            {usage(criterion)}. Saving gives each a new version if its copy changes.
          </p>
        ) : null}
      </div>

      {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}
      <div className="mt-5 flex justify-end gap-3">
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {criterion ? 'Save' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

function items(count: number): string {
  return `${count} wanted ${count === 1 ? 'item' : 'items'}`;
}

function usage({ items: count }: SharedCriterionRow): string {
  return count > 0 ? `Used by ${items(count)}` : 'Not used yet';
}

/** A blank filter is left out of the URL. */
function queryParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
