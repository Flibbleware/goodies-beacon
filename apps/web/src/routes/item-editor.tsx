import type { WantedItemStatus } from '@goodies-beacon/core/schemas';
import { WANTED_ITEM_STATUSES } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError } from '../api/client.js';
import { createItem, itemQuery, itemsQuery, type LoadedItem, saveItem } from '../api/items.js';
import { Alert, Button, CONTROL, Field } from '../components/form.js';
import { parseSpecText, STARTING_SPEC, withReferenceImage } from '../items/parse.js';
import { ReferenceImages } from '../items/reference-images.js';
import { SpecEditor } from '../items/spec-editor.js';
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
 * The manual spec editor (P1-13). One page for both a new item and an amendment to an existing
 * one, because saving is the same act either way: §4's spec versions are immutable, so every save
 * writes version N+1 and points the item at it.
 */
function Editor({ item }: { item: LoadedItem | undefined }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ids = { title: useId(), status: useId(), note: useId() };

  const [title, setTitle] = useState(item?.title ?? '');
  const [status, setStatus] = useState<WantedItemStatus>(item?.status ?? 'draft');
  const [text, setText] = useState(() =>
    item?.current ? `${JSON.stringify(item.current.document, null, 2)}\n` : STARTING_SPEC,
  );
  const [note, setNote] = useState('');

  // Landing on the page after another version was saved should show that version, not the old one.
  useEffect(() => {
    if (!item?.current) return;
    setTitle(item.title);
    setStatus(item.status);
    setText(`${JSON.stringify(item.current.document, null, 2)}\n`);
    setNote('');
  }, [item?.current, item?.title, item?.status]);

  const parsed = parseSpecText(text);

  const save = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error('The spec has to be valid before it can be saved.');
      const body = {
        title: title.trim(),
        status,
        spec: parsed.spec,
        changeNote: note.trim() === '' ? null : note.trim(),
      };
      return item ? saveItem(item.id, body) : createItem(body);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: itemQuery(saved.itemId).queryKey });
      if (!item) await navigate({ to: '/items/$itemId/edit', params: { itemId: saved.itemId } });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/items" className="text-sm text-ink-dim hover:underline dark:text-ink-dim-dark">
        ← Wanted items
      </Link>

      <h1 className="mt-2 text-xl font-semibold tracking-tight">
        {item ? item.title : 'New wanted item'}
      </h1>
      {item?.current ? (
        <p className="mt-1 text-sm text-ink-dim dark:text-ink-dim-dark">
          Version {item.current.version} is the one polling uses. Saving writes version{' '}
          {item.current.version + 1}.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
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
        </div>

        <SpecEditor value={text} onChange={setText} parsed={parsed} />

        <ReferenceImages
          canInsert={withReferenceImage(text, PROBE) !== undefined}
          onUploaded={(image) => {
            const updated = withReferenceImage(text, image);
            if (updated === undefined) return false;
            setText(updated);
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

/**
 * A plain list, as the task says: the side-by-side diff between two versions is Phase 3's, and
 * what is needed now is to see that a save made a version and what its note was.
 */
function VersionHistory({
  versions,
  currentId,
}: {
  versions: LoadedItem['versions'];
  currentId: string | undefined;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mt-10">
      <h2 id={headingId} className="font-medium">
        Version history
      </h2>
      <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge dark:divide-edge-dark dark:border-edge-dark">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
            <span className="text-sm font-medium">Version {version.version}</span>
            {version.id === currentId ? (
              <span className="rounded bg-paper-raised px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide dark:bg-paper-raised-dark">
                Current
              </span>
            ) : null}
            <time
              dateTime={version.createdAt}
              className="text-xs text-ink-dim dark:text-ink-dim-dark"
            >
              {new Date(version.createdAt).toLocaleString()}
            </time>
            <span className="w-full text-sm text-ink-dim dark:text-ink-dim-dark">
              {version.changeNote ?? 'No change note.'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
