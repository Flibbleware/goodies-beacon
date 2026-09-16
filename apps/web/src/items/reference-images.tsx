import { useMutation } from '@tanstack/react-query';
import { type ChangeEvent, useId, useRef, useState } from 'react';
import { uploadReferenceImage } from '../api/items.js';
import { Alert, Button, CONTROL, Field } from '../components/form.js';

/**
 * Reference image upload with labels (§8, P1-05 does the storing).
 *
 * The label is not decoration: the reviewer is shown it beside the photograph so it knows which
 * variant each one is of (§7 step 5), which is why an upload asks for one before it will run.
 */
export function ReferenceImages({
  onUploaded,
  canInsert,
}: {
  /** Appends the entry to the document; false means it could not be, and says why below. */
  onUploaded: (image: { id: string; path: string; label: string; addedAt: string }) => boolean;
  canInsert: boolean;
}) {
  const ids = { label: useId(), file: useId() };
  const fileInput = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [inserted, setInserted] = useState<string[]>([]);

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
    onSuccess: (image) => {
      setInserted((current) => [...current, image.label]);
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
        Uploaded, downscaled and added to the spec's{' '}
        <code className="font-mono">referenceImages</code>. The label is shown to the reviewer, so
        say which variant it is: “UK big box, front”.
      </p>

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
      {inserted.length > 0 ? (
        <Alert tone="ok">
          Added to the spec: {inserted.map((name) => name || 'unlabelled').join(', ')}.
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
