import type { ReactNode } from 'react';

/**
 * Text the owner writes that a model is sent word for word (P1-34): an item's summary, how sellers
 * list it, and each criterion. It is drawn like a terminal — monospace on an inset ground of its
 * own — so writing for a model reads apart from writing for the owner, with a caption naming which
 * of the two models reads it, since a note the reviewer never sees cannot change what it decides.
 */
export type Reader = 'prefilter' | 'both';

const READ_BY: Record<Reader, string> = {
  prefilter: 'read by the pre-filter',
  both: 'read by the pre-filter and reviewer',
};

const SURFACE =
  'border border-edge bg-terminal font-mono text-[0.8125rem] leading-relaxed dark:border-edge-dark dark:bg-terminal-dark';

/** A criterion's text in a row: the surface without the caption, which a list states once. */
export const PROMPT_INLINE = `block rounded-md px-2.5 py-1.5 ${SURFACE}`;

/** `CONTROL`'s shape on the prompt's ground, for the textarea that edits one. */
export const PROMPT_CONTROL = `mt-2 w-full rounded-lg px-3 py-2 outline-none focus:border-beacon dark:focus:border-beacon ${SURFACE}`;

/** The caption on a line of its own, under the text or the control it describes. */
export function ReadByLine({ reader }: { reader: Reader }) {
  return (
    <p className="mt-1 text-right">
      <ReadBy reader={reader} />
    </p>
  );
}

export function ReadBy({ reader }: { reader: Reader }) {
  return (
    <span className="font-mono text-[0.6875rem] text-ink-dim dark:text-ink-dim-dark">
      <span aria-hidden="true">› </span>
      {READ_BY[reader]}
    </span>
  );
}

export function PromptBlock({ reader, children }: { reader: Reader; children: ReactNode }) {
  return (
    <div className={`mt-1.5 rounded-lg ${SURFACE}`}>
      <div className="whitespace-pre-wrap px-3 py-2.5">{children}</div>
      <div className="border-t border-edge px-3 py-1 text-right dark:border-edge-dark">
        <ReadBy reader={reader} />
      </div>
    </div>
  );
}
