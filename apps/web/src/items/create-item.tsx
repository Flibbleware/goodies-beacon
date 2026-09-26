import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { createItem, itemsQuery } from '../api/items.js';
import { Alert, Button } from '../components/form.js';
import { Modal } from '../components/modal.js';
import { parseSpecText, STARTING_SPEC } from './parse.js';
import { ItemFields } from './section-editor.js';
import { SpecForm } from './spec-form.js';

/**
 * Creating a wanted item (P1-26): the Details editor's fields in a dialog of their own, with the
 * status locked to a draft and a summary required. Create writes version 1 and opens the item's
 * page, where the rest of the spec is filled in section by section and the red marks say what
 * polling still needs.
 *
 * The form is mounted only while the dialog is open, so each opening starts empty (P1-19).
 */
export function CreateItemModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const close = () => {
    setDirty(false);
    setConfirming(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create a Wanted Item"
      wide
      hold={dirty}
      onHeld={() => setConfirming(true)}
    >
      {open ? (
        <CreateForm
          onDirty={setDirty}
          confirming={confirming}
          setConfirming={setConfirming}
          onCancel={close}
        />
      ) : null}
    </Modal>
  );
}

function CreateForm({
  onDirty,
  confirming,
  setConfirming,
  onCancel,
}: {
  onDirty: (dirty: boolean) => void;
  confirming: boolean;
  setConfirming: (confirming: boolean) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [text, setText] = useState(STARTING_SPEC);

  const parsed = parseSpecText(text);
  const shown = parsed.ok ? parsed.spec : parsed.draft;
  const complete = title.trim() !== '' && (shown?.summary.trim() ?? '') !== '';
  const dirty = title !== '' || categoryId !== '' || text !== STARTING_SPEC;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const create = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error('The details have to be valid before the item is created.');
      return createItem({
        title: title.trim(),
        status: 'draft',
        categoryId: categoryId === '' ? null : categoryId,
        spec: parsed.spec,
        changeNote: 'Created.',
      });
    },
    onSuccess: async (saved) => {
      onDirty(false);
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
      // Replacing the dialog's URL, so Back from the new item does not open the dialog again.
      await navigate({ to: '/items/$itemId', params: { itemId: saved.itemId }, replace: true });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
      className="space-y-6"
    >
      <ItemFields
        title={title}
        setTitle={setTitle}
        categoryId={categoryId}
        setCategoryId={setCategoryId}
        status="draft"
        setStatus={() => {}}
        statusLocked
      />

      {shown ? (
        <SpecForm
          spec={shown}
          text={text}
          onChange={setText}
          warnings={[]}
          issues={parsed.ok ? [] : parsed.issues}
          parts={['describe']}
        />
      ) : null}

      {create.isError ? (
        <Alert tone="error">
          {create.error instanceof ApiError
            ? create.error.message
            : (create.error as Error).message}
        </Alert>
      ) : null}

      <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-edge bg-paper-raised px-5 py-3 dark:border-edge-dark dark:bg-paper-raised-dark">
        {confirming ? (
          <div
            role="alertdialog"
            aria-label="Unsaved changes"
            className="rounded-lg border border-amber-300 p-4 dark:border-amber-900"
          >
            <p className="text-sm font-medium">Discard this new item?</p>
            <div className="mt-3 flex gap-3">
              <Button type="button" variant="quiet" onClick={() => setConfirming(false)}>
                Keep Editing
              </Button>
              <Button type="button" variant="quiet" onClick={onCancel}>
                Discard
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={create.isPending || !complete || !parsed.ok}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => (dirty ? setConfirming(true) : onCancel())}
            >
              Cancel
            </Button>
            {complete ? null : (
              <span className="text-xs text-ink-dim dark:text-ink-dim-dark">
                A title and a summary are needed to create it.
              </span>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
