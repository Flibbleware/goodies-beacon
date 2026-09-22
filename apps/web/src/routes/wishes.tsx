import type { WishCategory } from '@goodies-beacon/core/schemas';
import {
  WISH_CATEGORIES,
  WISH_CATEGORY_LABELS,
  wishSaveSchema,
} from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
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
import { Alert, Button, CONTROL, Field } from '../components/form.js';
import { EditIcon, PromoteIcon, RemoveIcon, SearchIcon } from '../components/icons.js';
import { Modal } from '../components/modal.js';
import { CategoryIcon, CategoryTile } from '../wishes/category-icon.js';
import { sortWishes } from '../wishes/sort.js';
import { appLayoutRoute } from './app-layout.js';

export interface WishSearch {
  category?: WishCategory | undefined;
  /** Absent means A–Z, so the default view has a plain URL. */
  sort?: 'newest' | undefined;
}

export const wishesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/wishes',
  validateSearch: (search: Record<string, unknown>): WishSearch => ({
    category: (WISH_CATEGORIES as readonly unknown[]).includes(search.category)
      ? (search.category as WishCategory)
      : undefined,
    sort: search.sort === 'newest' ? 'newest' : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(wishesQuery),
  component: Wishes,
});

/**
 * The wish list (P1-19): things you would like, noted without a spec. Nothing polls or judges a
 * wish; the Search link is a search you run yourself, and Promote turns one into a wanted item
 * when it is worth having Goodies Beacon look.
 */
function Wishes() {
  const { category, sort } = wishesRoute.useSearch();
  const { data, isPending, isError } = useQuery(wishesQuery);
  const wishes = data?.wishes ?? [];
  const shown = sortWishes(
    category ? wishes.filter((wish) => wish.category === category) : wishes,
    sort ?? 'az',
  );
  const [adding, setAdding] = useState(false);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Wish list</h1>
        <Button type="button" onClick={() => setAdding(true)}>
          Add a wish
        </Button>
      </div>

      <AddWish open={adding} onClose={() => setAdding(false)} category={category} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Sort current={sort} category={category} />
        <Filter wishes={wishes} current={category} sort={sort} />
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
            {category
              ? `Nothing in ${WISH_CATEGORY_LABELS[category]} yet.`
              : 'Nothing on the wish list yet.'}
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
              <WishEntry wish={wish} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const EMPTY: WishSave = { label: '', category: 'game', searchUrl: '' };

type Errors = Partial<Record<keyof WishSave, string>>;

/** The same schema the server applies, so a bad link is named before anything is sent. */
function check(values: WishSave): Errors {
  const result = wishSaveSchema.safeParse(values);
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof WishSave;
    errors[key] ??= issue.message;
  }
  return errors;
}

/**
 * The add form, in a modal. The form is mounted only while the modal is open, so each opening
 * starts from fresh state rather than being reset: a reset in an effect lands a render after the
 * modal appears, and a keystroke in that gap wrote the previous wish's link into the next one.
 */
function AddWish({
  open,
  onClose,
  category,
}: {
  open: boolean;
  onClose: () => void;
  category: WishCategory | undefined;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add a wish">
      {open ? <AddWishForm category={category} onDone={onClose} /> : null}
    </Modal>
  );
}

function AddWishForm({
  category,
  onDone,
}: {
  category: WishCategory | undefined;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  // Adding while a category is filtered starts in that category, so the new row lands in view.
  const [values, setValues] = useState<WishSave>({
    ...EMPTY,
    category: category ?? EMPTY.category,
  });
  const [errors, setErrors] = useState<Errors>({});

  const add = useMutation({
    mutationFn: createWish,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: wishesQuery.queryKey });
      onDone();
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const found = check(values);
    setErrors(found);
    if (Object.keys(found).length === 0) add.mutate(values);
  };

  return (
    <form noValidate onSubmit={onSubmit}>
      <WishFields values={values} errors={errors} onChange={setValues} />
      {add.isError ? <Alert tone="error">{(add.error as Error).message}</Alert> : null}
      <div className="mt-5 flex justify-end gap-3">
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add to wish list'}
        </Button>
      </div>
    </form>
  );
}

function WishFields({
  values,
  errors,
  onChange,
}: {
  values: WishSave;
  errors: Errors;
  onChange: (values: WishSave) => void;
}) {
  const ids = { label: useId(), category: useId(), url: useId() };

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

      <Field id={ids.category} label="Category" error={errors.category}>
        <select
          id={ids.category}
          value={values.category}
          onChange={(event) =>
            onChange({ ...values, category: event.target.value as WishCategory })
          }
          className={CONTROL}
        >
          {WISH_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {WISH_CATEGORY_LABELS[value]}
            </option>
          ))}
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
    </div>
  );
}

const chip = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${
    active
      ? 'bg-paper-raised font-medium dark:bg-paper-raised-dark'
      : 'text-ink-dim hover:bg-paper-raised dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark'
  }`;

/**
 * Links rather than buttons, so a filtered view survives a reload and can be bookmarked. Each
 * keeps the current sort, as the sort links keep the category.
 */
function Filter({
  wishes,
  current,
  sort,
}: {
  wishes: readonly WishRow[];
  current: WishCategory | undefined;
  sort: WishSearch['sort'];
}) {
  return (
    <nav aria-label="Category" className="flex flex-wrap items-center gap-2">
      <Link
        to="/wishes"
        search={{ sort }}
        aria-current={current === undefined ? 'true' : undefined}
        className={chip(current === undefined)}
      >
        All · {wishes.length}
      </Link>
      {WISH_CATEGORIES.map((category) => (
        <Link
          key={category}
          to="/wishes"
          search={{ category, sort }}
          aria-current={current === category ? 'true' : undefined}
          className={chip(current === category)}
        >
          <CategoryIcon category={category} size="size-4" />
          {WISH_CATEGORY_LABELS[category]} ·{' '}
          {wishes.filter((wish) => wish.category === category).length}
        </Link>
      ))}
    </nav>
  );
}

function Sort({
  current,
  category,
}: {
  current: WishSearch['sort'];
  category: WishCategory | undefined;
}) {
  return (
    <nav aria-label="Sort" className="flex items-center gap-2">
      <Link
        to="/wishes"
        search={{ category }}
        aria-current={current === undefined ? 'true' : undefined}
        className={chip(current === undefined)}
      >
        A–Z
      </Link>
      <Link
        to="/wishes"
        search={{ category, sort: 'newest' }}
        aria-current={current === 'newest' ? 'true' : undefined}
        className={chip(current === 'newest')}
      >
        Newest
      </Link>
    </nav>
  );
}

function WishEntry({ wish }: { wish: WishRow }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'view' | 'edit' | 'promote' | 'remove'>('view');
  const [values, setValues] = useState<WishSave>(() => fromRow(wish));
  const [errors, setErrors] = useState<Errors>({});

  const refresh = () => queryClient.invalidateQueries({ queryKey: wishesQuery.queryKey });

  const save = useMutation({
    mutationFn: () => updateWish(wish.id, values),
    onSuccess: async () => {
      await refresh();
      setMode('view');
    },
  });
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
  const failed = save.error ?? remove.error ?? promote.error;

  if (mode === 'edit') {
    const onSubmit = (event: FormEvent) => {
      event.preventDefault();
      const found = check(values);
      setErrors(found);
      if (Object.keys(found).length === 0) save.mutate();
    };

    return (
      <form noValidate onSubmit={onSubmit} aria-label={`Edit ${wish.label}`}>
        <WishFields values={values} errors={errors} onChange={setValues} />
        {failed ? <Alert tone="error">{(failed as Error).message}</Alert> : null}
        <div className="mt-3 flex gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              setValues(fromRow(wish));
              setErrors({});
              setMode('view');
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CategoryTile category={wish.category} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{wish.label}</p>
          <p className="text-xs text-ink-dim dark:text-ink-dim-dark">
            {WISH_CATEGORY_LABELS[wish.category]}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            label={`Edit ${wish.label}`}
            onClick={() => {
              setValues(fromRow(wish));
              setMode('edit');
            }}
          >
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

function fromRow(wish: WishRow): WishSave {
  return { label: wish.label, category: wish.category, searchUrl: wish.searchUrl ?? '' };
}
