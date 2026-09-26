import type { ReferenceImage } from '@goodies-beacon/core/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useId, useState } from 'react';
import { itemQuery, itemsQuery, type LoadedItem, updateItem, uploadImage } from '../api/items.js';
import { Alert, Button, CONTROL, Field } from '../components/form.js';
import { Modal } from '../components/modal.js';

/**
 * The picture on the item's card in the wanted items list (P1-25): one of the reference images,
 * or an upload used for nothing else. It is the item's own field rather than part of the spec, so
 * it is never sent to the reviewer and choosing one writes no version — it saves the moment it is
 * picked, as pausing does.
 */
export function DisplayImage({
  item,
  references,
}: {
  item: LoadedItem;
  references: readonly ReferenceImage[];
}) {
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const headingId = useId();

  const set = useMutation({
    mutationFn: (displayImageId: string | null) => updateItem(item.id, { displayImageId }),
    onSuccess: async () => {
      setChoosing(false);
      await queryClient.invalidateQueries({ queryKey: itemQuery(item.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
    },
  });

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 flex flex-wrap items-start gap-4 rounded-xl border border-edge p-5 dark:border-edge-dark"
    >
      <div className="aspect-[4/3] w-32 shrink-0 overflow-hidden rounded-lg border border-edge dark:border-edge-dark">
        {item.displayImageId ? (
          <img
            src={`/api/media/${item.displayImageId}/thumb`}
            alt={item.title}
            className="size-full object-cover"
          />
        ) : (
          <span className="block size-full bg-edge/60 dark:bg-edge-dark/60" />
        )}
      </div>

      <div className="min-w-0 flex-1 basis-56">
        <h3 id={headingId} className="text-sm font-medium">
          Display image
        </h3>
        <p className="mt-1 text-xs text-ink-dim dark:text-ink-dim-dark">
          {item.displayImageId
            ? 'Shown on this item’s card in the wanted items list.'
            : 'None: the list shows the category’s icon instead.'}{' '}
          Never sent to the reviewer, and changing it writes no version.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button type="button" variant="quiet" onClick={() => setChoosing(true)}>
            {item.displayImageId ? 'Change' : 'Choose'}
          </Button>
          {item.displayImageId ? (
            <Button
              type="button"
              variant="quiet"
              onClick={() => set.mutate(null)}
              disabled={set.isPending}
            >
              Remove
            </Button>
          ) : null}
        </div>
        {set.isError && !choosing ? <Failure error={set.error} /> : null}
      </div>

      <Modal
        open={choosing}
        onClose={() => {
          set.reset();
          setChoosing(false);
        }}
        title="Choose a Display Image"
      >
        {choosing ? (
          <Chooser
            current={item.displayImageId}
            references={references}
            onChoose={(id) => set.mutate(id)}
            saving={set.isPending}
            error={set.isError ? set.error : null}
            onCancel={() => {
              set.reset();
              setChoosing(false);
            }}
          />
        ) : null}
      </Modal>
    </section>
  );
}

function Chooser({
  current,
  references,
  onChoose,
  saving,
  error,
  onCancel,
}: {
  current: string | null;
  references: readonly ReferenceImage[];
  onChoose: (id: string) => void;
  saving: boolean;
  error: Error | null;
  onCancel: () => void;
}) {
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose an image first.');
      return uploadImage(file);
    },
    onSuccess: (media) => onChoose(media.id),
  });

  const busy = saving || upload.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">From the reference images</h3>
        {references.length === 0 ? (
          <p className="mt-2 text-sm text-ink-dim dark:text-ink-dim-dark">
            This item has none yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-3">
            {references.map((image) => (
              <li key={image.id} className="w-28">
                <button
                  type="button"
                  onClick={() => onChoose(image.id)}
                  disabled={busy || image.id === current}
                  aria-label={`Use ${image.label || 'this reference image'}`}
                  className={`block size-28 overflow-hidden rounded-lg border-2 disabled:cursor-default ${image.id === current ? 'border-beacon' : 'border-transparent hover:border-edge dark:hover:border-edge-dark'}`}
                >
                  <img
                    src={`/api/media/${image.id}/thumb`}
                    alt=""
                    className="size-full object-cover"
                  />
                </button>
                <p className="mt-1 truncate text-xs" title={image.label}>
                  {image.id === current ? 'In use' : image.label || 'unlabelled'}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-dim dark:text-ink-dim-dark">
          A reference image chosen here is still sent to the reviewer, because it is a reference
          image; being the display image changes nothing about that.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium">Or upload one for the card only</h3>
        <div className="mt-3">
          <Field id={fileId} label="Image">
            <input
              id={fileId}
              name="file"
              type="file"
              accept="image/*"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setFile(event.target.files?.[0] ?? null)
              }
              className={`${CONTROL} file:mr-3 file:rounded file:border-0 file:bg-paper-raised file:px-2 file:py-1 file:text-xs dark:file:bg-paper-raised-dark`}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Button type="button" onClick={() => upload.mutate()} disabled={busy || !file}>
            {upload.isPending ? 'Uploading…' : 'Upload and Use'}
          </Button>
        </div>
      </div>

      {upload.isError ? <Failure error={upload.error} /> : null}
      {error ? <Failure error={error} /> : null}

      <div className="flex justify-end">
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Failure({ error }: { error: Error }) {
  return <Alert tone="error">{error.message || 'Could not save the image.'}</Alert>;
}
