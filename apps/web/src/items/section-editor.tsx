import type { WantedItemStatus } from '@goodies-beacon/core/schemas';
import { WANTED_ITEM_STATUSES } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { categoriesQuery } from '../api/categories.js';
import { ApiError } from '../api/client.js';
import { itemQuery, itemsQuery, type LoadedItem, saveItem, updateItem } from '../api/items.js';
import { CategoryOptions } from '../components/category-filter.js';
import { Alert, Button, CONTROL, Field } from '../components/form.js';
import { Modal } from '../components/modal.js';
import { parseSpecText, withoutReferenceImage, withReferenceImage } from './parse.js';
import { ReferenceImages } from './reference-images.js';
import { SpecEditor } from './spec-editor.js';
import { SpecForm, type SpecFormPart } from './spec-form.js';
import { STATUS_LABELS } from './status.js';

export type EditableSection =
  | 'describe'
  | 'settings'
  | 'criteria'
  | 'images'
  | 'searchPlans'
  | 'json';

/** A slice of the typed form, or one of the two editors that are not it. */
const SECTIONS: Record<
  EditableSection,
  {
    title: string;
    parts: readonly SpecFormPart[] | 'images' | 'json';
    note: string;
    wide: boolean;
  }
> = {
  describe: {
    title: 'Edit Details',
    parts: ['describe'],
    note: 'Edited the details.',
    wide: true,
  },
  settings: {
    title: 'Edit Settings',
    parts: ['settings'],
    note: 'Edited the settings.',
    wide: true,
  },
  criteria: {
    title: 'Edit Criteria',
    parts: ['criteria'],
    note: 'Edited the criteria.',
    wide: true,
  },
  images: {
    title: 'Edit Reference Images',
    parts: 'images',
    note: 'Edited the reference images.',
    wide: false,
  },
  searchPlans: {
    title: 'Edit Search Plans',
    parts: ['searchPlans'],
    note: 'Edited the search plans.',
    wide: true,
  },
  json: {
    title: 'Edit JSON',
    parts: 'json',
    note: 'Edited the JSON.',
    wide: true,
  },
};

/**
 * One section of the item page edited in a modal of its own (P1-24).
 *
 * It is the full editor's typed form cut down to one part, over its own copy of the document, and
 * saving is the same act: the whole spec goes to `saveItem` and becomes version N+1. Details also
 * holds the title, category and status, which are the item's own fields rather than the spec's
 * (P1-25): changed on their own they are patched onto the item without a version, and changed
 * alongside the summary they travel with the version that saves it. The JSON editor is the whole document, for a paste, a wholesale
 * rewrite, or a spec the schema no longer reads and the typed sections therefore cannot draw.
 *
 * The body is mounted only while the modal is open, so each opening starts from the stored
 * version rather than from whatever the last one left behind (P1-19's lesson).
 */
export function SectionEditor({
  item,
  section,
  onClose,
}: {
  item: LoadedItem;
  section: EditableSection | null;
  onClose: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const close = () => {
    setDirty(false);
    setConfirming(false);
    onClose();
  };

  return (
    <Modal
      open={section !== null}
      onClose={close}
      title={section ? SECTIONS[section].title : ''}
      wide={section ? SECTIONS[section].wide : false}
      hold={dirty}
      onHeld={() => setConfirming(true)}
    >
      {section && item.current ? (
        <Body
          item={item}
          document={item.current.document}
          section={section}
          onDirty={setDirty}
          confirming={confirming}
          setConfirming={setConfirming}
          onDone={close}
        />
      ) : null}
    </Modal>
  );
}

function Body({
  item,
  document,
  section,
  onDirty,
  confirming,
  setConfirming,
  onDone,
}: {
  item: LoadedItem;
  document: Record<string, unknown>;
  section: EditableSection;
  onDirty: (dirty: boolean) => void;
  confirming: boolean;
  setConfirming: (confirming: boolean) => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const noteId = useId();
  const config = SECTIONS[section];

  const [initial] = useState(() => `${JSON.stringify(document, null, 2)}\n`);
  const [text, setText] = useState(initial);
  const [title, setTitle] = useState(item.title);
  const [categoryId, setCategoryId] = useState(item.categoryId ?? '');
  const [status, setStatus] = useState<WantedItemStatus>(item.status);
  const [note, setNote] = useState('');
  const [uploaded, setUploaded] = useState<ReadonlySet<string>>(new Set());

  const parsed = parseSpecText(text);
  const shown = parsed.ok ? parsed.spec : parsed.draft;
  const specChanged = text !== initial;
  // Only Details has anything to save that is not the spec.
  const versioned = section !== 'describe' || specChanged;
  const dirty =
    specChanged ||
    title !== item.title ||
    categoryId !== (item.categoryId ?? '') ||
    status !== item.status;
  const unsaved: ReadonlySet<string> = new Set(
    (shown?.referenceImages ?? []).map((image) => image.id).filter((id) => uploaded.has(id)),
  );

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // The modal holds Esc and the backdrop; this holds Back and a reload.
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
    disabled: !dirty,
  });

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        title: title.trim(),
        status,
        categoryId: categoryId === '' ? null : categoryId,
      };
      if (!specChanged) return updateItem(item.id, fields);
      if (!parsed.ok) throw new Error('The spec has to be valid before it can be saved.');
      return saveItem(item.id, {
        ...fields,
        spec: parsed.spec,
        changeNote: note.trim() === '' ? config.note : note.trim(),
      });
    },
    onSuccess: async () => {
      onDirty(false);
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: itemQuery(item.id).queryKey });
      onDone();
    },
  });

  const held = confirming || blocker.status === 'blocked';

  const keepEditing = () => {
    if (blocker.status === 'blocked') blocker.reset();
    setConfirming(false);
  };

  const discard = () => {
    if (blocker.status === 'blocked') blocker.proceed();
    else onDone();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className="space-y-6"
    >
      {section === 'describe' ? (
        <ItemFields
          title={title}
          setTitle={setTitle}
          categoryId={categoryId}
          setCategoryId={setCategoryId}
          status={status}
          setStatus={setStatus}
        />
      ) : null}

      {!parsed.ok && shown && config.parts !== 'json' ? (
        <Alert tone="error">
          Not saveable yet —{' '}
          {parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}.
        </Alert>
      ) : null}

      {config.parts === 'json' ? (
        <SpecEditor value={text} onChange={setText} parsed={parsed} rows={22} />
      ) : shown === undefined ? null : Array.isArray(config.parts) ? (
        <SpecForm
          spec={shown}
          text={text}
          onChange={setText}
          warnings={parsed.ok ? parsed.warnings : (parsed.warnings ?? [])}
          issues={parsed.ok ? [] : parsed.issues}
          parts={config.parts}
        />
      ) : (
        <ReferenceImages
          framed={false}
          images={shown.referenceImages}
          canInsert
          unsaved={unsaved}
          onRemove={(id) => {
            const updated = withoutReferenceImage(text, id);
            if (updated !== undefined) setText(updated);
          }}
          onUploaded={(image) => {
            const updated = withReferenceImage(text, image);
            if (updated === undefined) return false;
            setText(updated);
            setUploaded((current) => new Set(current).add(image.id));
            return true;
          }}
        />
      )}

      {/* A note describes a version, so it is asked for only when there will be one. */}
      {versioned ? (
        <Field id={noteId} label="Change note" hint={`Left empty: “${config.note}”`}>
          <input
            id={noteId}
            name="changeNote"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={CONTROL}
          />
        </Field>
      ) : null}

      {save.isError ? (
        <Alert tone="error">
          {save.error instanceof ApiError ? save.error.message : (save.error as Error).message}
        </Alert>
      ) : null}

      {/* Pinned to the modal's foot, because the settings editor is taller than most screens. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-edge bg-paper-raised px-5 py-3 dark:border-edge-dark dark:bg-paper-raised-dark">
        {held ? (
          <div
            role="alertdialog"
            aria-label="Unsaved changes"
            className="rounded-lg border border-amber-300 p-4 dark:border-amber-900"
          >
            <p className="text-sm font-medium">Discard these changes?</p>
            <p className="mt-1 text-sm text-ink-dim dark:text-ink-dim-dark">
              Nothing here is saved yet.
              {unsaved.size > 0
                ? ` ${unsaved.size === 1 ? 'The uploaded image stays' : 'The uploaded images stay'} on the server with nothing pointing at ${unsaved.size === 1 ? 'it' : 'them'}.`
                : ''}
            </p>
            <div className="mt-3 flex gap-3">
              <Button type="button" variant="quiet" onClick={keepEditing}>
                Keep Editing
              </Button>
              <Button type="button" variant="quiet" onClick={discard}>
                Discard
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={save.isPending || !parsed.ok || !dirty || title.trim() === ''}
            >
              {save.isPending
                ? 'Saving…'
                : versioned
                  ? `Save as Version ${(item.current?.version ?? 0) + 1}`
                  : 'Save'}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => (dirty ? setConfirming(true) : onDone())}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}

/** What the item is called and how it is kept, which only the Details editor changes. */
function ItemFields({
  title,
  setTitle,
  categoryId,
  setCategoryId,
  status,
  setStatus,
}: {
  title: string;
  setTitle: (title: string) => void;
  categoryId: string;
  setCategoryId: (categoryId: string) => void;
  status: WantedItemStatus;
  setStatus: (status: WantedItemStatus) => void;
}) {
  const ids = { title: useId(), category: useId(), status: useId() };
  const categories = useQuery(categoriesQuery).data?.categories ?? [];

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id={ids.title} label="Title" hint="What you call it. Shown in emails and lists.">
          <input
            id={ids.title}
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={CONTROL}
          />
        </Field>
      </div>

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
  );
}
