import type { WantedItemStatus } from '@goodies-beacon/core/schemas';
import { WANTED_ITEM_STATUSES } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useState } from 'react';
import { categoriesQuery } from '../api/categories.js';
import { ApiError } from '../api/client.js';
import { createItem, itemQuery, itemsQuery, type LoadedItem, saveItem } from '../api/items.js';
import { CategoryOptions } from '../components/category-filter.js';
import { Alert, Button, CONTROL, Field } from '../components/form.js';
import { parseSpecText, STARTING_SPEC, withDocument, withReferenceImage } from '../items/parse.js';
import { ReferenceImages } from '../items/reference-images.js';
import { SpecEditor } from '../items/spec-editor.js';
import { SpecForm } from '../items/spec-form.js';
import { VersionHistory } from '../items/version-history.js';
import { appLayoutRoute } from './app-layout.js';

export const newItemRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/items/new',
  component: NewItem,
});

export const editItemRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/items/$itemId/edit',
  loader: ({ context, params }) => context.queryClient.ensureQueryData(itemQuery(params.itemId)),
  component: EditItem,
});

const STATUS_LABELS: Record<WantedItemStatus, string> = {
  draft: 'Draft — not polled',
  active: 'Active — polled on schedule',
  paused: 'Paused',
  found: 'Found',
  archived: 'Archived',
};

/** Only ever used to ask whether an image *could* be added; never written anywhere. */
const PROBE = { id: 'probe', path: 'probe', label: 'probe', addedAt: '1970-01-01T00:00:00.000Z' };

function NewItem() {
  return <Editor item={undefined} />;
}

function EditItem() {
  const { itemId } = editItemRoute.useParams();
  const { data } = useQuery(itemQuery(itemId));

  return data ? <Editor item={data.item} /> : null;
}

/**
 * The manual spec editor (P1-13, typed form in P1-18). One page for both a new item and an
 * amendment to an existing one, because saving is the same act either way: §4's spec versions are
 * immutable, so every save writes version N+1 and points the item at it.
 *
 * The form and the JSON are two surfaces onto one string of text, not two models of a spec. The
 * text is what is edited and what is saved; the form reads the parsed document and writes back
 * through `withDocument`, so switching between them cannot lose anything.
 */
function Editor({ item }: { item: LoadedItem | undefined }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ids = { title: useId(), status: useId(), category: useId(), note: useId() };
  const tabIds = { form: useId(), json: useId(), panel: useId() };

  const [title, setTitle] = useState(item?.title ?? '');
  const [status, setStatus] = useState<WantedItemStatus>(item?.status ?? 'draft');
  const categories = useQuery(categoriesQuery).data?.categories ?? [];
  // '' is no category, which is what a select can hold.
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  const [text, setText] = useState(() =>
    item?.current ? `${JSON.stringify(item.current.document, null, 2)}\n` : STARTING_SPEC,
  );
  const [note, setNote] = useState('');
  const [surface, setSurface] = useState<'form' | 'json'>('form');

  /**
   * Media stored by an upload in this visit. The file exists on the server the moment it is
   * uploaded while the document that points at it lives only in `text`, so leaving without saving
   * orphans it — which is what the blocker below is for.
   */
  const [uploaded, setUploaded] = useState<ReadonlySet<string>>(new Set());

  // Landing on the page after another version was saved should show that version, not the old one.
  useEffect(() => {
    if (!item?.current) return;
    setTitle(item.title);
    setStatus(item.status);
    setCategoryId(item.categoryId ?? '');
    setText(`${JSON.stringify(item.current.document, null, 2)}\n`);
    setNote('');
    setUploaded(new Set());
  }, [item?.current, item?.title, item?.status, item?.categoryId]);

  const parsed = parseSpecText(text);
  // What the form draws: the saveable spec, or the draft that keeps it up while a field is empty.
  const shown = parsed.ok ? parsed.spec : parsed.draft;

  // Only uploads the document still points at are at risk: one deleted from the JSON by hand is
  // already gone from the spec. While the document cannot be read, assume every one of them is.
  const unsaved: ReadonlySet<string> = shown
    ? new Set(shown.referenceImages.map((image) => image.id).filter((id) => uploaded.has(id)))
    : uploaded;

  const blocker = useBlocker({
    shouldBlockFn: () => unsaved.size > 0,
    enableBeforeUnload: () => unsaved.size > 0,
    withResolver: true,
    disabled: unsaved.size === 0,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error('The spec has to be valid before it can be saved.');
      const body = {
        title: title.trim(),
        status,
        categoryId: categoryId === '' ? null : categoryId,
        spec: parsed.spec,
        changeNote: note.trim() === '' ? null : note.trim(),
      };
      return item ? saveItem(item.id, body) : createItem(body);
    },
    onSuccess: async (saved) => {
      setUploaded(new Set());
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: itemQuery(saved.itemId).queryKey });
      if (!item) await navigate({ to: '/items/$itemId/edit', params: { itemId: saved.itemId } });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const removeImage = (id: string) => {
    const updated = withDocument(text, (document) => {
      if (!Array.isArray(document.referenceImages)) return;
      document.referenceImages = document.referenceImages.filter(
        (entry) =>
          entry === null || typeof entry !== 'object' || (entry as { id?: unknown }).id !== id,
      );
    });
    if (updated !== undefined) setText(updated);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'form'
        : event.key === 'End'
          ? 'json'
          : surface === 'form'
            ? 'json'
            : 'form';
    setSurface(next);
    document.getElementById(tabIds[next])?.focus();
  };

  return (
    <div className="mx-auto max-w-3xl">
      {item ? (
        <Link
          to="/items/$itemId"
          params={{ itemId: item.id }}
          className="text-sm text-ink-dim hover:underline dark:text-ink-dim-dark"
        >
          ← {item.title}
        </Link>
      ) : (
        <Link to="/items" className="text-sm text-ink-dim hover:underline dark:text-ink-dim-dark">
          ← Wanted items
        </Link>
      )}

      <h1 className="mt-2 text-xl font-semibold tracking-tight">
        {item ? item.title : 'New wanted item'}
      </h1>
      {item?.current ? (
        <p className="mt-1 text-sm text-ink-dim dark:text-ink-dim-dark">
          Version {item.current.version} is the one polling uses. Saving writes version{' '}
          {item.current.version + 1}.
        </p>
      ) : null}

      {blocker.status === 'blocked' ? (
        <div
          role="alertdialog"
          aria-label="Unsaved reference images"
          className="mt-4 rounded-lg border border-amber-300 p-4 dark:border-amber-900"
        >
          <p className="text-sm font-medium">
            {unsaved.size === 1 ? 'An image is' : `${unsaved.size} images are`} uploaded but not in
            a saved version.
          </p>
          <p className="mt-1 text-sm text-ink-dim dark:text-ink-dim-dark">
            Leaving now loses{' '}
            {unsaved.size === 1 ? 'the reference to it' : 'the references to them'}, and the stored
            file{unsaved.size === 1 ? ' stays' : 's stay'} on the server with nothing pointing at{' '}
            {unsaved.size === 1 ? 'it' : 'them'}.
          </p>
          <div className="mt-3 flex gap-3">
            <Button type="button" variant="quiet" onClick={blocker.reset}>
              Stay and save
            </Button>
            <Button type="button" variant="quiet" onClick={blocker.proceed}>
              Leave anyway
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id={ids.title} label="Title" hint="What you call it. Shown in emails and lists.">
              <input
                id={ids.title}
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Carmageddon big box"
                className={CONTROL}
              />
            </Field>
          </div>

          <Field
            id={ids.status}
            label="Status"
            hint="Only an active item is polled; the rest keep their spec and do nothing."
          >
            <select
              id={ids.status}
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as WantedItemStatus)}
              className={CONTROL}
            >
              {WANTED_ITEM_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            id={ids.category}
            label="Category"
            hint="For sorting your list; nothing searches or judges by it. Made in Settings."
          >
            <select
              id={ids.category}
              name="category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={CONTROL}
            >
              <CategoryOptions categories={categories} />
            </select>
          </Field>
        </div>

        <div>
          <div role="tablist" aria-label="Editing surface" className="flex gap-2">
            {(['form', 'json'] as const).map((choice) => (
              <button
                key={choice}
                id={tabIds[choice]}
                type="button"
                role="tab"
                aria-selected={surface === choice}
                aria-controls={tabIds.panel}
                tabIndex={surface === choice ? 0 : -1}
                onClick={() => setSurface(choice)}
                onKeyDown={onTabKey}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  surface === choice
                    ? 'bg-beacon text-white'
                    : 'border border-edge dark:border-edge-dark'
                }`}
              >
                {choice === 'form' ? 'Form' : 'JSON'}
              </button>
            ))}
          </div>

          <div id={tabIds.panel} role="tabpanel" aria-labelledby={tabIds[surface]} className="mt-4">
            {surface === 'form' && shown ? (
              <>
                {parsed.ok ? null : (
                  <Alert tone="error">
                    Not saveable yet —{' '}
                    {parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}.
                  </Alert>
                )}
                <SpecForm
                  spec={shown}
                  text={text}
                  onChange={setText}
                  warnings={parsed.ok ? parsed.warnings : (parsed.warnings ?? [])}
                  issues={parsed.ok ? [] : parsed.issues}
                />
              </>
            ) : (
              <>
                {surface === 'form' ? (
                  <Alert tone="error">
                    The spec does not have the shape the form draws. Fix it below and the form comes
                    back.
                  </Alert>
                ) : null}
                <SpecEditor value={text} onChange={setText} parsed={parsed} />
              </>
            )}
          </div>
        </div>

        <ReferenceImages
          images={shown?.referenceImages}
          canInsert={withReferenceImage(text, PROBE) !== undefined}
          unsaved={unsaved}
          onRemove={removeImage}
          onUploaded={(image) => {
            const updated = withReferenceImage(text, image);
            if (updated === undefined) return false;
            setText(updated);
            setUploaded((current) => new Set(current).add(image.id));
            return true;
          }}
        />

        <Field
          id={ids.note}
          label="Change note"
          hint="Why this version exists. Left empty, the note in the JSON is kept."
        >
          <input
            id={ids.note}
            name="changeNote"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Dropped the PC release."
            className={CONTROL}
          />
        </Field>

        {save.isError ? (
          <Alert tone="error">
            {save.error instanceof ApiError ? save.error.message : (save.error as Error).message}
          </Alert>
        ) : null}
        {save.isSuccess ? <Alert tone="ok">Saved as version {save.data.version}.</Alert> : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending || !parsed.ok || title.trim() === ''}>
            {save.isPending ? 'Saving…' : item ? 'Save new version' : 'Create item'}
          </Button>
        </div>
      </form>

      {item ? (
        <VersionHistory versions={item.versions} currentId={item.current?.versionId} />
      ) : null}
    </div>
  );
}
