import type { CategoryColour, CategoryIcon } from '@goodies-beacon/core/schemas';
import { CATEGORY_COLOURS, CATEGORY_ICONS, categorySaveSchema } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import {
  type CategoryRow,
  type CategorySave,
  categoriesQuery,
  createCategory,
  deleteCategory,
  refreshCategories,
  updateCategory,
} from '../api/categories.js';
import { CategoryTile, ColourSwatch, Glyph } from '../components/category-icon.js';
import { Alert, Button, CONTROL, Field, NO_AUTOFILL, Section } from '../components/form.js';
import { Modal } from '../components/modal.js';

const ICON_LABELS: Record<CategoryIcon, string> = {
  gamepad: 'Gamepad',
  disc: 'Disc',
  cassette: 'Cassette',
  robot: 'Robot',
  figurine: 'Figurine',
  book: 'Book',
  star: 'Star',
  heart: 'Heart',
  box: 'Box',
  music: 'Music',
  camera: 'Camera',
  monitor: 'Monitor',
  gem: 'Gem',
  trophy: 'Trophy',
  tag: 'Tag',
  coin: 'Coin',
  shirt: 'Shirt',
};

const COLOUR_LABELS: Record<CategoryColour, string> = {
  violet: 'Violet',
  indigo: 'Indigo',
  blue: 'Blue',
  cyan: 'Cyan',
  teal: 'Teal',
  green: 'Green',
  amber: 'Amber',
  orange: 'Orange',
  copper: 'Copper',
  pink: 'Pink',
  fuchsia: 'Fuchsia',
  slate: 'Slate',
};

/**
 * The owner's categories (P1-22), shared by the wish list and the wanted items. Deleting one in
 * use leaves those wishes and items uncategorised, and the confirmation says how many.
 */
export function CategoriesSection() {
  const { data, isPending, isError } = useQuery(categoriesQuery);
  // `null` is closed; an empty object is adding, and one holding a category is editing it.
  const [editing, setEditing] = useState<{ category?: CategoryRow } | null>(null);
  const categories = data?.categories ?? [];

  return (
    <Section title="Categories">
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-dim dark:text-ink-dim-dark">
          For sorting the wish list and the wanted items. Nothing searches or judges by them.
        </p>
        <Button type="button" onClick={() => setEditing({})}>
          Add a Category
        </Button>
      </div>

      {isPending ? (
        <p className="mt-4 text-sm text-ink-dim dark:text-ink-dim-dark">Loading…</p>
      ) : null}
      {isError ? <Alert tone="error">Could not load the categories.</Alert> : null}
      {data && categories.length === 0 ? (
        <p className="mt-4 text-sm text-ink-dim dark:text-ink-dim-dark">No categories yet.</p>
      ) : null}

      {categories.length > 0 ? (
        <ul
          aria-label="Categories"
          className="mt-4 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark"
        >
          {categories.map((category) => (
            <li key={category.id} className="p-3">
              <CategoryEntry category={category} onEdit={() => setEditing({ category })} />
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.category ? `Edit ${editing.category.name}` : 'Add a Category'}
      >
        {/* Mounted only while open, so each opening starts fresh (see the wish list's modal). */}
        {editing !== null ? (
          <CategoryForm
            key={editing.category?.id}
            category={editing.category}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Modal>
    </Section>
  );
}

function CategoryEntry({ category, onEdit }: { category: CategoryRow; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteCategory(category.id),
    onSuccess: () => refreshCategories(queryClient),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CategoryTile category={category} size="size-10" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{category.name}</p>
          <p className="text-xs text-ink-dim dark:text-ink-dim-dark">{usage(category)}</p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="quiet"
            onClick={onEdit}
            aria-label={`Edit ${category.name}`}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="quiet"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${category.name}`}
          >
            Delete
          </Button>
        </div>
      </div>

      {confirming ? (
        <div
          role="alertdialog"
          aria-label={`Delete ${category.name}`}
          className="mt-3 rounded-lg border border-edge p-3 text-sm dark:border-edge-dark"
        >
          <p>
            Delete {category.name}?{' '}
            {category.wishes + category.items > 0
              ? `${usage(category)} will be left without a category.`
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

const EMPTY: CategorySave = { name: '', icon: 'star', colour: 'blue' };

function CategoryForm({
  category,
  onDone,
}: {
  category: CategoryRow | undefined;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const nameId = useId();
  const [values, setValues] = useState<CategorySave>(() =>
    category ? { name: category.name, icon: category.icon, colour: category.colour } : EMPTY,
  );
  const [nameError, setNameError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: (body: CategorySave) =>
      category ? updateCategory(category.id, body) : createCategory(body),
    onSuccess: async () => {
      await refreshCategories(queryClient);
      onDone();
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = categorySaveSchema.safeParse(values);
    setNameError(result.success ? undefined : result.error.issues[0]?.message);
    if (result.success) save.mutate(result.data);
  };

  return (
    <form noValidate onSubmit={onSubmit}>
      <div className="flex items-end gap-3">
        <CategoryTile category={values} />
        <div className="flex-1">
          <Field id={nameId} label="Name" error={nameError}>
            <input
              id={nameId}
              {...NO_AUTOFILL}
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
              placeholder="Vinyl"
              className={CONTROL}
            />
          </Field>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Icon</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORY_ICONS.map((icon) => (
            <label key={icon} title={ICON_LABELS[icon]} className={CHOICE}>
              <input
                type="radio"
                name="icon"
                value={icon}
                aria-label={ICON_LABELS[icon]}
                checked={values.icon === icon}
                onChange={() => setValues({ ...values, icon })}
                className="sr-only"
              />
              <Glyph icon={icon} className="size-5" />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Colour</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORY_COLOURS.map((colour) => (
            <label key={colour} title={COLOUR_LABELS[colour]} className={CHOICE}>
              <input
                type="radio"
                name="colour"
                value={colour}
                aria-label={COLOUR_LABELS[colour]}
                checked={values.colour === colour}
                onChange={() => setValues({ ...values, colour })}
                className="sr-only"
              />
              <ColourSwatch colour={colour} />
            </label>
          ))}
        </div>
      </fieldset>

      {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}
      <div className="mt-5 flex justify-end gap-3">
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {category ? 'Save' : 'Add Category'}
        </Button>
      </div>
    </form>
  );
}

const CHOICE =
  'inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-edge text-ink-dim hover:bg-paper dark:border-edge-dark dark:text-ink-dim-dark dark:hover:bg-paper-dark has-[:checked]:border-beacon has-[:checked]:text-ink has-[:checked]:ring-2 has-[:checked]:ring-beacon/30 dark:has-[:checked]:text-ink-dark has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-beacon';

function usage({ wishes, items }: CategoryRow): string {
  const parts = [];
  if (wishes > 0) parts.push(`${wishes} ${wishes === 1 ? 'wish' : 'wishes'}`);
  if (items > 0) parts.push(`${items} wanted ${items === 1 ? 'item' : 'items'}`);
  return parts.length > 0 ? parts.join(' and ') : 'Not used yet';
}
