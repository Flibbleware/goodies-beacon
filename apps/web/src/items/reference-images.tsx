import type { ReferenceImage } from '@goodies-beacon/core/schemas';
import { useMutation } from '@tanstack/react-query';
import { type ChangeEvent, useId, useRef, useState } from 'react';
import { uploadReferenceImage } from '../api/items.js';
import { Alert, Button, CONTROL, Field } from '../components/form.js';

/**
 * Reference image upload with labels (§8, P1-05 does the storing).
 *
 * The label is not decoration: the reviewer is shown it beside the photograph so it knows which
 * variant each one is of (§7 step 5), which is why an upload asks for one before it will run.
 *
 * What is already on the spec is shown here as thumbnails. Until P1-18 it was not: the upload
 * cleared its own fields and appended an entry below the fold of the JSON editor, so a successful
 * upload and a swallowed one looked identical. An image also only reaches the spec when the spec
 * is saved, which the unsaved count says out loud rather than leaving to be discovered.
 */
export function ReferenceImages({
  images,
  onUploaded,
  onRemove,
  unsaved,
  canInsert,
}: {
  /** Undefined while the document cannot be read, which is not the same as having none. */
  images: readonly ReferenceImage[] | undefined;
  /** Appends the entry to the document; false means it could not be, and says why below. */
  onUploaded: (image: { id: string; path: string; label: string; addedAt: string }) => boolean;
  onRemove: (id: string) => void;
  /** Ids uploaded in this session and not yet saved into a version. */
  unsaved: ReadonlySet<string>;
  canInsert: boolean;
}) {
  const ids = { label: useId(), file: useId() };
  const fileInput = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose an image first.');
      const media = await uploadReferenceImage(file, label.trim());
      const image = {
        id: media.id,
        path: media.path,
        label: label.trim(),
        addedAt: new Date().toISOString(),
      };

      // The image is stored either way; only the entry in the document can fail to be written.
      if (!onUploaded(image)) {
        throw new Error('The image was stored, but the spec is not JSON it can be added to.');
      }
      return image;
    },
    onSuccess: () => {
      setLabel('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
    },
  });

  const onFile = (event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null);

  return (
    <div className="rounded-xl border border-edge p-4 dark:border-edge-dark">
      <h3 className="text-sm font-medium">Reference images</h3>
      <p className="mt-1.5 text-xs text-ink-dim dark:text-ink-dim-dark">
        Shown to the reviewer with every review of this item, so the label should say which variant
        each one is: “UK big box, front”.
      </p>

      {images === undefined ? (
        <p className="mt-4 text-sm text-ink-dim dark:text-ink-dim-dark">
          The spec cannot be read as it stands, so its images cannot be shown. Fix it above and they
          come back.
        </p>
      ) : images.length > 0 ? (
        <>
          <ul className="mt-4 flex flex-wrap gap-4">
            {images.map((image) => (
              <li key={image.id} className="w-28">
                <img
                  src={`/api/media/${image.id}/thumb`}
                  alt={image.label || 'Reference image'}
                  className="h-28 w-28 rounded-lg border border-edge object-cover dark:border-edge-dark"
                />
                <p className="mt-1 truncate text-xs" title={image.label}>
                  {image.label || 'unlabelled'}
                </p>
                {unsaved.has(image.id) ? (
                  <p className="text-xs text-amber-700 dark:text-amber-500">not saved yet</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRemove(image.id)}
                  disabled={!canInsert}
                  className="mt-0.5 text-xs text-red-600 hover:underline disabled:opacity-50 disabled:hover:no-underline dark:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {/* §7 step 5: each one is re-sent on every review, at 1,000–1,500 tokens apiece. */}
          <p className="mt-3 text-xs text-ink-dim dark:text-ink-dim-dark">
            {images.length} image{images.length === 1 ? '' : 's'} sent with every review of this
            item.
            {images.length >= 6 ? ' That is a lot; each one costs tokens every time.' : ''}
          </p>
        </>
      ) : (
        <p className="mt-4 text-sm text-ink-dim dark:text-ink-dim-dark">
          None yet. The reviewer judges from the criteria alone.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id={ids.label} label="Label">
          <input
            id={ids.label}
            name="label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="UK big box, front"
            className={CONTROL}
          />
        </Field>

        <Field id={ids.file} label="Image">
          <input
            id={ids.file}
            name="file"
            type="file"
            accept="image/*"
            ref={fileInput}
            onChange={onFile}
            className={`${CONTROL} file:mr-3 file:rounded file:border-0 file:bg-paper-raised file:px-2 file:py-1 file:text-xs dark:file:bg-paper-raised-dark`}
          />
        </Field>
      </div>

      {upload.isError ? <Alert tone="error">{(upload.error as Error).message}</Alert> : null}
      {!canInsert ? (
        <Alert tone="error">
          The spec is not valid JSON, so there is nowhere to put an image yet.
        </Alert>
      ) : null}
      {unsaved.size > 0 ? (
        <Alert tone="warn">
          {unsaved.size === 1 ? 'One image is' : `${unsaved.size} images are`} stored but not yet in
          a saved version. Save below, or {unsaved.size === 1 ? 'it is' : 'they are'} lost.
        </Alert>
      ) : null}

      <div className="mt-4">
        <Button
          type="button"
          variant="quiet"
          onClick={() => upload.mutate()}
          disabled={upload.isPending || !file || label.trim() === '' || !canInsert}
        >
          {upload.isPending ? 'Uploading…' : 'Upload and add'}
        </Button>
      </div>
    </div>
  );
}
