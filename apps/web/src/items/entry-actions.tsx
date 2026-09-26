import type { Criterion, WantedSpec } from '@goodies-beacon/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client.js';
import { sharedCriteriaQuery } from '../api/criteria.js';
import { itemQuery, itemsQuery, type LoadedItem, saveItem } from '../api/items.js';
import { Alert, Button } from '../components/form.js';
import { EditIcon, RemoveIcon } from '../components/icons.js';
import { Modal } from '../components/modal.js';

const ICON_BUTTON =
  'rounded p-1 text-ink-dim hover:bg-paper-raised hover:text-ink dark:text-ink-dim-dark dark:hover:bg-paper-raised-dark dark:hover:text-ink-dark';

/** A criterion's or a search plan's own pencil and bin on the item page (P1-27). */
export function EntryActions({
  name,
  editable = true,
  onEdit,
  onRemove,
}: {
  /** Finishes "Edit …" and "Remove …" for their accessible names. */
  name: string;
  editable?: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      {editable ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${name}`}
          title="Edit"
          className={ICON_BUTTON}
        >
          <EditIcon />
        </button>
      ) : (
        // Holds the pencil's place, so the text beside a row without one stops where the others do.
        <span aria-hidden="true" className="size-6" />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        title="Remove"
        className={`${ICON_BUTTON} hover:text-red-600 dark:hover:text-red-400`}
      >
        <RemoveIcon />
      </button>
    </>
  );
}

/**
 * A copy of a shared criterion that fixes everything has nothing to edit here, so it has no pencil;
 * it can still be removed.
 */
export function CriterionActions({
  criterion,
  onEdit,
  onRemove,
}: {
  criterion: Criterion;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const shared = useQuery(sharedCriteriaQuery).data?.criteria.find(
    (row) => row.key === criterion.shared,
  );
  const editable =
    criterion.shared === undefined ||
    (shared !== undefined &&
      (shared.kind === null || shared.quantifiable === null || shared.onUnknown === null));

  return (
    <EntryActions
      name={`the criterion ${criterion.id}`}
      editable={editable}
      onEdit={onEdit}
      onRemove={onRemove}
    />
  );
}

/** What a bin asks to take out of the spec, and the spec without it. */
export interface Removal {
  /** The dialog's title: "Remove a Criterion". */
  title: string;
  /** What is being removed, as the owner reads it. */
  what: string;
  /** Anything more worth saying before it goes. */
  aside?: string | undefined;
  spec: WantedSpec;
  changeNote: string;
}

/** Asks before removing an entry, which saves the spec without it as version N+1. */
export function RemoveFromSpec({
  item,
  removal,
  onClose,
}: {
  item: LoadedItem;
  removal: Removal | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const next = (item.current?.version ?? 0) + 1;

  const remove = useMutation({
    mutationFn: (target: Removal) =>
      saveItem(item.id, {
        title: item.title,
        status: item.status,
        categoryId: item.categoryId,
        spec: target.spec,
        changeNote: target.changeNote,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: itemQuery(item.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: sharedCriteriaQuery.queryKey });
      onClose();
    },
  });

  const close = () => {
    remove.reset();
    onClose();
  };

  return (
    <Modal open={removal !== null} onClose={close} title={removal?.title ?? ''}>
      {removal ? (
        <div className="space-y-4">
          <p className="text-sm">{removal.what}</p>
          <p className="text-sm text-ink-dim dark:text-ink-dim-dark">
            Removing it saves the spec without it as version {next}.
            {removal.aside ? ` ${removal.aside}` : ''}
          </p>
          {remove.isError ? (
            <Alert tone="error">
              {remove.error instanceof ApiError ? remove.error.message : 'Could not remove it.'}
            </Alert>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(removal)}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
