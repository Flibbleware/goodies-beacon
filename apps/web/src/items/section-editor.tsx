import type { WantedSpec } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useId, useLayoutEffect, useState } from 'react';
import { categoriesQuery } from '../api/categories.js';
import { ApiError } from '../api/client.js';
import { sharedCriteriaQuery } from '../api/criteria.js';
import { itemQuery, itemsQuery, type LoadedItem, saveItem, updateItem } from '../api/items.js';
import { CategoryOptions } from '../components/category-filter.js';
import { Alert, Button, CONTROL, Field, NO_AUTOFILL } from '../components/form.js';
import { Modal } from '../components/modal.js';
import { toast } from '../components/toasts.js';
import { criterionName, planName } from './labels.js';
import { parseSpecText, withDocument, withoutReferenceImage, withReferenceImage } from './parse.js';
import { ReferenceImages } from './reference-images.js';
import { SpecEditor } from './spec-editor.js';
import {
  type EntryFocus,
  newSearchPlan,
  ownCriterion,
  SpecForm,
  type SpecFormPart,
} from './spec-form.js';

export type EditableSection =
  | 'describe'
  | 'marketplaceSettings'
  | 'generalSettings'
  | 'addCriterion'
  | 'images'
  | 'addSearchPlan'
  | 'json';

/** A section, or one criterion or search plan of the spec's, by its position. */
export type EditTarget = EditableSection | { criterion: number } | { plan: number };

interface SectionConfig {
  title: string;
  parts: readonly SpecFormPart[] | 'images' | 'json';
  note: string;
  wide: boolean;
}

/** A slice of the typed form, or one of the two editors that are not it. */
const SECTIONS: Record<EditableSection, SectionConfig> = {
  describe: {
    title: 'Edit Details',
    parts: ['describe'],
    note: 'Edited the details.',
    wide: true,
  },
  marketplaceSettings: {
    title: 'Edit Marketplace Settings',
    parts: ['marketplaceSettings'],
    note: 'Edited the marketplace settings.',
    wide: true,
  },
  generalSettings: {
    title: 'Edit General Settings',
    parts: ['generalSettings'],
    note: 'Edited the general settings.',
    wide: true,
  },
  addCriterion: {
    title: 'Add a Criterion',
    parts: ['criterion'],
    note: 'Added a criterion.',
    wide: true,
  },
  images: {
    title: 'Edit Reference Images',
    parts: 'images',
    note: 'Edited the reference images.',
    wide: false,
  },
  addSearchPlan: {
    title: 'Add a Search Plan',
    parts: ['searchPlan'],
    note: 'Added a search plan.',
    wide: true,
  },
  json: {
    title: 'Edit JSON',
    parts: 'json',
    note: 'Edited the JSON.',
    wide: true,
  },
};

const EDIT_CRITERION: SectionConfig = {
  title: 'Edit Criterion',
  parts: ['criterion'],
  note: 'Edited a criterion.',
  wide: true,
};

const EDIT_SEARCH_PLAN: SectionConfig = {
  title: 'Edit Search Plan',
  parts: ['searchPlan'],
  note: 'Edited a search plan.',
  wide: true,
};

const configOf = (target: EditTarget): SectionConfig =>
  typeof target === 'string'
    ? SECTIONS[target]
    : 'criterion' in target
      ? EDIT_CRITERION
      : EDIT_SEARCH_PLAN;

/** The one entry of a list a target edits, or `new` for the one it adds. */
interface Entry {
  list: 'criteria' | 'searchPlans';
  index: number | 'new';
}

function entryOf(target: EditTarget): Entry | undefined {
  if (target === 'addCriterion') return { list: 'criteria', index: 'new' };
  if (target === 'addSearchPlan') return { list: 'searchPlans', index: 'new' };
  if (typeof target === 'string') return undefined;
  return 'criterion' in target
    ? { list: 'criteria', index: target.criterion }
    : { list: 'searchPlans', index: target.plan };
}

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
  section: EditTarget | null;
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
      title={section ? configOf(section).title : ''}
      wide={section ? configOf(section).wide : false}
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
  section: EditTarget;
  onDirty: (dirty: boolean) => void;
  confirming: boolean;
  setConfirming: (confirming: boolean) => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const config = configOf(section);
  // Adding starts from the spec with a blank entry already on the end, so that entry is what the
  // form edits and leaving it blank is no change at all.
  const [entry] = useState(() => entryOf(section));
  const [focus] = useState<EntryFocus | undefined>(() => {
    if (!entry) return undefined;
    if (entry.index !== 'new') return { index: entry.index, adding: false };
    const list = document[entry.list];
    return { index: Array.isArray(list) ? list.length : 0, adding: true };
  });
  const [initial] = useState(() => {
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (entry?.index !== 'new') return text;
    const current = parseSpecText(text);
    const spec = current.ok ? current.spec : current.draft;
    return (
      (spec &&
        withDocument(text, (raw) => {
          const list = raw[entry.list];
          raw[entry.list] = [
            ...(Array.isArray(list) ? list : []),
            entry.list === 'criteria' ? ownCriterion(spec) : newSearchPlan(spec),
          ];
        })) ??
      text
    );
  });
  const [text, setText] = useState(initial);
  const [title, setTitle] = useState(item.title);
  const [categoryId, setCategoryId] = useState(item.categoryId ?? '');
  const [note, setNote] = useState('');
  const [uploaded, setUploaded] = useState<ReadonlySet<string>>(new Set());

  const parsed = parseSpecText(text);
  const shown = parsed.ok ? parsed.spec : parsed.draft;
  const specChanged = text !== initial;
  const defaultNote = entryNote(entry, focus, shown) ?? config.note;
  // Only Details has anything to save that is not the spec.
  const versioned = section !== 'describe' || specChanged;
  const nextVersion = (item.current?.version ?? 0) + 1;
  const dirty = specChanged || title !== item.title || categoryId !== (item.categoryId ?? '');
  const unsaved: ReadonlySet<string> = new Set(
    (shown?.referenceImages ?? []).map((image) => image.id).filter((id) => uploaded.has(id)),
  );

  // A layout effect, so the modal holds Esc from the same frame the first keystroke lands in; a
  // plain effect runs after paint, and an Esc straight after typing got in first and lost the edit.
  useLayoutEffect(() => onDirty(dirty), [dirty, onDirty]);

  // The modal holds Esc and the backdrop; this holds Back and a reload.
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
    disabled: !dirty,
  });

  const save = useMutation({
    mutationFn: async () => {
      const fields = { title: title.trim(), categoryId: categoryId === '' ? null : categoryId };
      if (!specChanged) return updateItem(item.id, fields);
      if (!parsed.ok) throw new Error('The spec has to be valid before it can be saved.');
      // The status is changed from the page's header (P1-28); a save carries it through as it is.
      return saveItem(item.id, {
        ...fields,
        status: item.status,
        spec: parsed.spec,
        changeNote: note.trim() === '' ? defaultNote : note.trim(),
      });
    },
    onSuccess: async () => {
      onDirty(false);
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: itemQuery(item.id).queryKey });
      // The Criteria page counts the items using each shared criterion, which a save can change.
      await queryClient.invalidateQueries({ queryKey: sharedCriteriaQuery.queryKey });
      onDone();
      toast.ok(
        versioned ? `${defaultNote} Saved as version ${nextVersion}.` : 'Saved the details.',
      );
    },
    onError: () =>
      toast.error(
        versioned ? `Could not save version ${nextVersion}.` : 'Could not save the details.',
      ),
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
        />
      ) : null}

      {/* Not before anything is typed: a new criterion starts blank, which is not a fault. */}
      {specChanged && !parsed.ok && shown && config.parts !== 'json' ? (
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
          focus={focus}
        />
      ) : (
        <ReferenceImages
          images={shown.referenceImages}
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

      {save.isError ? (
        <Alert tone="error">
          {save.error instanceof ApiError ? save.error.message : (save.error as Error).message}
        </Alert>
      ) : null}

      {/* Pinned to the modal's foot, because the settings editor is taller than most screens. */}
      <div className="sticky bottom-0 -mx-5 mt-10 -mb-5 border-t border-edge bg-paper-raised px-5 py-3 dark:border-edge-dark dark:bg-paper-raised-dark">
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
            <div className="mt-3 flex justify-end gap-3">
              <Button type="button" variant="quiet" onClick={keepEditing}>
                Keep Editing
              </Button>
              <Button type="button" variant="quiet" onClick={discard}>
                Discard
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            {/* A note describes a version, so it is asked for only when there will be one. */}
            {versioned ? (
              <input
                name="changeNote"
                aria-label="Change note"
                placeholder="change note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="w-75 max-w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm outline-none focus:border-beacon dark:border-edge-dark dark:bg-paper-dark"
              />
            ) : null}
            <div className="ml-auto flex gap-3">
              <Button
                type="button"
                variant="quiet"
                onClick={() => (dirty ? setConfirming(true) : onDone())}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={save.isPending || !parsed.ok || !dirty || title.trim() === ''}
              >
                {save.isPending ? 'Saving…' : versioned ? `Save as Version ${nextVersion}` : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

/** A change note naming the criterion or search plan added or edited, once it has a name. */
function entryNote(
  entry: Entry | undefined,
  focus: EntryFocus | undefined,
  spec: WantedSpec | undefined,
): string | undefined {
  if (!entry || !focus || !spec) return undefined;
  const verb = focus.adding ? 'Added' : 'Edited';
  if (entry.list === 'criteria') {
    const criterion = spec.criteria[focus.index];
    return criterion ? `${verb} the criterion ${criterionName(criterion)}.` : undefined;
  }
  const plan = spec.searchPlans[focus.index];
  return plan ? `${verb} the search plan ${planName(plan)}.` : undefined;
}

/**
 * What the item is called and how it is sorted: the Details editor's, and the Create dialog's
 * (P1-26). The status is not here; it is chosen from the item page's header (P1-28).
 */
export function ItemFields({
  title,
  setTitle,
  categoryId,
  setCategoryId,
}: {
  title: string;
  setTitle: (title: string) => void;
  categoryId: string;
  setCategoryId: (categoryId: string) => void;
}) {
  const ids = { title: useId(), category: useId() };
  const categories = useQuery(categoriesQuery).data?.categories ?? [];

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field id={ids.title} label="Title" hint="What you call it. Shown in emails and lists.">
        <input
          id={ids.title}
          name="title"
          {...NO_AUTOFILL}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={CONTROL}
        />
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
  );
}
