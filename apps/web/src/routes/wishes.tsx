import { joinTags, matchesTag, splitTags, wishSaveSchema } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { type CategoryRow, categoriesQuery } from '../api/categories.js';
import { itemsQuery } from '../api/items.js';
import {
  createWish,
  deleteWish,
  promoteWish,
  updateWish,
  type WishRow,
  type WishSave,
  wishesQuery,
} from '../api/wishes.js';
import {
  type CategoryChoice,
  CategoryFilter,
  CategoryOptions,
  choiceName,
  filterChip,
  inChoice,
  knownChoice,
  UNCATEGORISED,
} from '../components/category-filter.js';
import { CategoryTile } from '../components/category-icon.js';
import { Alert, Button, CONTROL, Field } from '../components/form.js';
import { EditIcon, PromoteIcon, RemoveIcon, SearchIcon } from '../components/icons.js';
import { Modal } from '../components/modal.js';
import { TagPills } from '../components/tag-pills.js';
import { sortWishes } from '../wishes/sort.js';
import { appLayoutRoute } from './app-layout.js';

export interface WishSearch {
  /** A category's id, or `none` for the uncategorised. */
  category?: string | undefined;
  /** Absent means A–Z, so the default view has a plain URL. */
  sort?: 'newest' | undefined;
  /** Part of a tag, matched ignoring case (P1-21). */
  tag?: string | undefined;
}

export const wishesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/wishes',
  validateSearch: (search: Record<string, unknown>): WishSearch => ({
    category: typeof search.category === 'string' ? search.category : undefined,
    sort: search.sort === 'newest' ? 'newest' : undefined,
    tag: tagParam(
      // The router reads `?tag=1990` as a number.
      typeof search.tag === 'number' ? String(search.tag) : search.tag,
    ),
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(wishesQuery),
      context.queryClient.ensureQueryData(categoriesQuery),
    ]),
  component: Wishes,
});

/**
 * The wish list (P1-19): things you would like, noted without a spec. Nothing polls or judges a
 * wish; the Search link is a search you run yourself, and Promote turns one into a wanted item
 * when it is worth having Goodies Beacon look.
 */
function Wishes() {
  const search = wishesRoute.useSearch();
  const { sort, tag } = search;
  const navigate = useNavigate({ from: '/wishes' });
  const { data, isPending, isError } = useQuery(wishesQuery);
  const categories = useQuery(categoriesQuery).data?.categories ?? [];
  const category = knownChoice(categories, search.category);
  const wishes = data?.wishes ?? [];
  // The box is driven by its own state and copied to the URL, not read back from it: the URL
  // settles a navigation later, and a controlled input a keystroke behind loses its caret.
  const [query, setQuery] = useState(tag ?? '');
  const tagged = wishes.filter((wish) => matchesTag(wish.tags, query));
  const shown = sortWishes(
    tagged.filter((wish) => inChoice(wish.categoryId, category)),
    sort ?? 'az',
  );
  // `null` is closed; an empty object is adding, and one holding a wish is editing it.
  const [editing, setEditing] = useState<{ wish?: WishRow } | null>(null);

  const filterBy = (value: string) => {
    setQuery(value);
    void navigate({ search: (prev) => ({ ...prev, tag: tagParam(value) }), replace: true });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Wish list</h1>
        <Button type="button" onClick={() => setEditing({})}>
          Add a wish
        </Button>
      </div>

      <WishModal
        open={editing !== null}
        wish={editing?.wish}
        categories={categories}
        category={category}
        onClose={() => setEditing(null)}
      />

      <div className="mt-4">
        <input
          type="search"
          aria-label="Filter by tag"
          placeholder="Filter by tag…"
          value={query}
          onChange={(event) => filterBy(event.target.value)}
          className={CONTROL}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Sort current={sort} category={category} tag={tagParam(query)} />
        <CategoryFilter
          categories={categories}
          items={tagged}
          current={category}
          link={({ category: chosen, active, className, children }) => (
            // Choosing a category keeps the sort and the tag filter, as the sort links do.
            <Link
              to="/wishes"
              search={{ category: chosen, sort, tag: tagParam(query) }}
              aria-current={active ? 'true' : undefined}
              className={className}
            >
              {children}
            </Link>
          )}
        />
      </div>

      {isPending ? (
        <p className="mt-6 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
          Could not load the wish list.
        </p>
      ) : null}

      {data && shown.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-edge p-8 text-center dark:border-edge-dark">
          <p className="text-sm text-ink-dim dark:text-ink-dim-dark">
            {emptyMessage(choiceName(categories, category), tagParam(query))}
          </p>
        </div>
      ) : null}

      {shown.length > 0 ? (
        <ul
          aria-label="Wishes"
          className="mt-4 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark"
        >
          {shown.map((wish) => (
            <li key={wish.id} className="p-4">
              <WishEntry
                wish={wish}
                category={categories.find((each) => each.id === wish.categoryId)}
                onEdit={() => setEditing({ wish })}
                onPickTag={filterBy}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** What the form edits: the tags as the one comma-separated field they are typed into. */
type WishValues = Omit<WishSave, 'tags' | 'categoryId'> & { tags: string; categoryId: string };

// '' is no category, which is what a select can hold.
const EMPTY: WishValues = { label: '', categoryId: '', searchUrl: '', tags: '' };

type Errors = Partial<Record<keyof WishValues, string>>;

const toSave = (values: WishValues): WishSave => ({
  ...values,
  categoryId: values.categoryId === '' ? null : values.categoryId,
  tags: splitTags(values.tags),
});

/** The same schema the server applies, so a bad link is named before anything is sent. */
function check(values: WishValues): Errors {
  const result = wishSaveSchema.safeParse(toSave(values));
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof WishValues;
    errors[key] ??= issue.message;
  }
  return errors;
}

/**
 * Adding and editing a wish share one modal (P1-21). The form is mounted only while the modal is
 * open, so each opening starts from fresh state rather than being reset: a reset in an effect
 * lands a render after the modal appears, and a keystroke in that gap wrote the previous wish's
 * link into the next one.
 */
function WishModal({
  open,
  wish,
  categories,
  category,
  onClose,
}: {
  open: boolean;
  wish: WishRow | undefined;
  categories: readonly CategoryRow[];
  category: CategoryChoice;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={wish ? `Edit ${wish.label}` : 'Add a wish'}>
      {open ? (
        <WishForm
          key={wish?.id}
          wish={wish}
          categories={categories}
          category={category}
          onDone={onClose}
        />
      ) : null}
    </Modal>
  );
}

function WishForm({
  wish,
  categories,
  category,
  onDone,
}: {
  wish: WishRow | undefined;
  categories: readonly CategoryRow[];
  category: CategoryChoice;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  // Adding while a category is filtered starts in that category, so the new row lands in view.
  const [values, setValues] = useState<WishValues>(() =>
    wish
      ? fromRow(wish)
      : { ...EMPTY, categoryId: category && category !== UNCATEGORISED ? category : '' },
  );
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({
    mutationFn: (body: WishSave) => (wish ? updateWish(wish.id, body) : createWish(body)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: wishesQuery.queryKey });
      onDone();
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const found = check(values);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate(toSave(values));
  };
  const submit = wish
    ? { idle: 'Save', pending: 'Saving…' }
    : { idle: 'Add to wish list', pending: 'Adding…' };

  return (
    <form noValidate onSubmit={onSubmit}>
      <WishFields values={values} errors={errors} categories={categories} onChange={setValues} />
      {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}
      <div className="mt-5 flex justify-end gap-3">
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? submit.pending : submit.idle}
        </Button>
      </div>
    </form>
  );
}

function WishFields({
  values,
  errors,
  categories,
  onChange,
}: {
  values: WishValues;
  errors: Errors;
  categories: readonly CategoryRow[];
  onChange: (values: WishValues) => void;
}) {
  const ids = { label: useId(), category: useId(), url: useId(), tags: useId() };

  return (
    <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
      <Field id={ids.label} label="Label" error={errors.label}>
        <input
          id={ids.label}
          value={values.label}
          onChange={(event) => onChange({ ...values, label: event.target.value })}
          placeholder="Jurassic Park, big box"
          className={CONTROL}
        />
      </Field>

      <Field id={ids.category} label="Category" error={errors.categoryId}>
        <select
          id={ids.category}
          value={values.categoryId}
          onChange={(event) => onChange({ ...values, categoryId: event.target.value })}
          className={CONTROL}
        >
          <CategoryOptions categories={categories} />
        </select>
      </Field>

      <div className="sm:col-span-2">
        <Field
          id={ids.url}
          label="Search link"
          hint="Optional. A saved search or a shop page; Search opens it in a new tab."
          error={errors.searchUrl}
        >
          <input
            id={ids.url}
            type="url"
            inputMode="url"
            value={values.searchUrl}
            onChange={(event) => onChange({ ...values, searchUrl: event.target.value })}
            placeholder="https://www.ebay.co.uk/sch/i.html?_nkw=…"
            className={CONTROL}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field
          id={ids.tags}
          label="Tags"
          hint="Optional. Your own words to find it by, separated by commas."
          error={errors.tags}
        >
          <input
            id={ids.tags}
            value={values.tags}
            onChange={(event) => onChange({ ...values, tags: event.target.value })}
            placeholder="big box, 90s, Spielberg"
            className={CONTROL}
          />
        </Field>
      </div>
    </div>
  );
}

function Sort({
  current,
  category,
  tag,
}: {
  current: WishSearch['sort'];
  category: CategoryChoice;
  tag: string | undefined;
}) {
  return (
    <nav aria-label="Sort" className="flex items-center gap-2">
      <Link
        to="/wishes"
        search={{ category, tag }}
        aria-current={current === undefined ? 'true' : undefined}
        className={filterChip(current === undefined)}
      >
        A–Z
      </Link>
      <Link
        to="/wishes"
        search={{ category, sort: 'newest', tag }}
        aria-current={current === 'newest' ? 'true' : undefined}
        className={filterChip(current === 'newest')}
      >
        Newest
      </Link>
    </nav>
  );
}

function WishEntry({
  wish,
  category,
  onEdit,
  onPickTag,
}: {
  wish: WishRow;
  category: CategoryRow | undefined;
  onEdit: () => void;
  onPickTag: (tag: string) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'view' | 'promote' | 'remove'>('view');

  const refresh = () => queryClient.invalidateQueries({ queryKey: wishesQuery.queryKey });

  const remove = useMutation({ mutationFn: () => deleteWish(wish.id), onSuccess: refresh });
  const promote = useMutation({
    mutationFn: () => promoteWish(wish.id),
    onSuccess: async (saved) => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey }),
      ]);
      await navigate({ to: '/items/$itemId/edit', params: { itemId: saved.itemId } });
    },
  });
  const failed = remove.error ?? promote.error;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CategoryTile category={category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium break-words">{wish.label}</p>
            <TagPills tags={wish.tags} onPick={onPickTag} />
          </div>
          {category ? (
            <p className="text-xs text-ink-dim dark:text-ink-dim-dark">{category.name}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <IconButton label={`Edit ${wish.label}`} onClick={onEdit}>
            <EditIcon />
          </IconButton>
          <IconButton
            label={`Remove ${wish.label}`}
            tone="danger"
            onClick={() => setMode('remove')}
          >
            <RemoveIcon />
          </IconButton>
          <IconButton
            label={`Promote ${wish.label}`}
            hint={`Promote ${wish.label} to a wanted item`}
            tone="accent"
            onClick={() => setMode('promote')}
          >
            <PromoteIcon />
          </IconButton>
          {wish.searchUrl ? (
            <a
              href={wish.searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Search for ${wish.label} (opens in a new tab)`}
              title="Search (opens in a new tab)"
              className="inline-flex size-8 items-center justify-center rounded-lg bg-beacon text-white hover:opacity-90"
            >
              <SearchIcon />
            </a>
          ) : (
            // `aria-disabled` rather than `disabled`: it keeps the tooltip saying why, and keeps
            // the button reachable by keyboard so a screen reader can find that out too.
            <button
              type="button"
              aria-disabled="true"
              aria-label={`Search for ${wish.label}`}
              title="No search link yet — add one with Edit"
              className="inline-flex size-8 items-center justify-center rounded-lg bg-beacon text-white opacity-35"
            >
              <SearchIcon />
            </button>
          )}
        </div>
      </div>

      {mode === 'promote' || mode === 'remove' ? (
        <div
          role="alertdialog"
          aria-label={mode === 'promote' ? 'Promote to a wanted item' : 'Remove from the wish list'}
          className="mt-3 rounded-lg border border-edge p-3 text-sm dark:border-edge-dark"
        >
          <p>
            {mode === 'promote'
              ? 'Make this a wanted item? It leaves the wish list and opens in the spec editor as a draft, where you describe what to search for.'
              : 'Remove this from the wish list?'}
          </p>
          <div className="mt-3 flex gap-3">
            <Button
              type="button"
              disabled={promote.isPending || remove.isPending}
              onClick={() => (mode === 'promote' ? promote.mutate() : remove.mutate())}
            >
              {mode === 'promote' ? 'Promote' : 'Remove'}
            </Button>
            <Button type="button" variant="quiet" onClick={() => setMode('view')}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {failed ? <Alert tone="error">{(failed as Error).message}</Alert> : null}
    </div>
  );
}

const ICON_BUTTON_HOVER = {
  neutral: 'hover:text-ink dark:hover:text-ink-dark',
  accent: 'hover:text-beacon',
  danger: 'hover:text-red-600 dark:hover:text-red-400',
};

/**
 * A square button showing only an icon. `label` is its accessible name; `hint` is the tooltip,
 * when the icon needs more explaining than the name gives.
 */
function IconButton({
  label,
  hint = label,
  tone = 'neutral',
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  tone?: keyof typeof ICON_BUTTON_HOVER;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint}
      onClick={onClick}
      className={`inline-flex size-8 items-center justify-center rounded-lg border border-edge text-ink-dim hover:bg-paper-raised dark:border-edge-dark dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark ${ICON_BUTTON_HOVER[tone]}`}
    >
      {children}
    </button>
  );
}

function fromRow(wish: WishRow): WishValues {
  return {
    label: wish.label,
    categoryId: wish.categoryId ?? '',
    searchUrl: wish.searchUrl ?? '',
    tags: joinTags(wish.tags),
  };
}

/** A blank filter is left out of the URL, as the default sort is. */
function tagParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** `category` is the chosen filter's name, empty when none is chosen. */
function emptyMessage(category: string, tag: string | undefined): string {
  if (tag) {
    return category
      ? `Nothing in ${category} tagged “${tag.trim()}”.`
      : `No wishes tagged “${tag.trim()}”.`;
  }
  return category ? `Nothing in ${category} yet.` : 'Nothing on the wish list yet.';
}
