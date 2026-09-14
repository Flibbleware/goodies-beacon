import type { ImageStrategy } from '@goodies-beacon/core';
import type { FilePart, TextPart } from 'ai';

/**
 * How images are laid out in a prompt, and in what order (§9).
 *
 * Two things are being bought here. The **strategy** decides how several example images are
 * presented: `separate` gives each one its own block with its label as a caption, which is what
 * every provider but Google prices best and the only one Phase 1 builds. The **order** is the
 * more valuable of the two — everything that is the same for every candidate of an item goes
 * first, so a provider that caches prompt prefixes can charge a tenth for it on the second and
 * every subsequent listing.
 */

/**
 * A `file` part rather than the older `image` one: the SDK deprecated `image` in favour of
 * `file` with a media type, and the deprecated form logs a warning on every single call.
 */
export type PromptPart = TextPart | FilePart;

export interface LabelledImage {
  /**
   * The image itself: bytes, or a `data:` URI.
   *
   * Deliberately **not** a remote URL. The AI SDK resolves one by fetching it itself, which would
   * send a marketplace-supplied address straight out of the worker with none of §12's protections
   * — no private-address block list, no size cap, no content-type check — and P1-05 built exactly
   * those. Every image in a prompt is one this instance has already fetched under guard,
   * re-encoded and stored, so passing the stored bytes is both safer and what the reviewer should
   * be looking at.
   */
  image: Uint8Array | string;
  /** The stored file's type, from the `media` row P1-05 wrote. */
  mediaType?: string;
  /** Shown to the model so it knows which variant the photo is of (§7 step 5). */
  label: string;
}

export interface ReviewPromptInput {
  /** Identical for every candidate of this item, so it is the cacheable prefix. */
  stable: {
    instructions: string;
    specSummary: string;
    criteria: string;
    referenceImages: readonly LabelledImage[];
    /** Attached grading scale examples, when there is one (Phase 5). */
    gradeImages?: readonly LabelledImage[];
  };
  /** Different every time, so it goes last and invalidates nothing before it. */
  listing: {
    text: string;
    images: readonly LabelledImage[];
  };
  strategy?: ImageStrategy;
}

export class UnsupportedStrategyError extends Error {
  override readonly name = 'UnsupportedStrategyError';
}

export class RemoteImageError extends Error {
  override readonly name = 'RemoteImageError';
}

/** Anything the SDK would go and fetch for us, which is the thing that must not happen. */
const REMOTE_URL = /^(https?|ftp):\/\//i;

/**
 * One image with its label, as the `separate` strategy sends it.
 *
 * The caption goes *before* the image rather than after: a model reads the parts in order, and a
 * label that arrives after the picture has to be attached to it retrospectively.
 */
function labelled(entry: LabelledImage): PromptPart[] {
  if (typeof entry.image === 'string' && REMOTE_URL.test(entry.image)) {
    /**
     * Caught here rather than trusted, because the failure is silent and serious: the SDK would
     * fetch it, and a listing's image URL is attacker-controlled input from a marketplace. Ingest
     * it through P1-05's `storeImage` and pass the stored bytes.
     */
    throw new RemoteImageError(
      `a prompt image must be bytes or a data: URI, not ${entry.image.slice(0, 40)}… — ` +
        'fetch it through the media ingest first, so the SSRF guard and the size cap apply',
    );
  }

  const parts: PromptPart[] = [];
  if (entry.label !== '') parts.push({ type: 'text', text: entry.label });
  // `image` as a media type means "any image", which every provider resolves from the bytes.
  parts.push({ type: 'file', data: entry.image, mediaType: entry.mediaType ?? 'image' });
  return parts;
}

function pack(images: readonly LabelledImage[], strategy: ImageStrategy): PromptPart[] {
  if (strategy === 'contact_sheet') {
    /**
     * Deferred to Phase 5 deliberately (§9): tiling examples onto one image only pays under
     * Google's per-tile pricing, and everywhere else the composite is downscaled to the
     * provider's per-image cap and loses the detail the reviewer is being asked to judge.
     * Refusing is better than silently sending `separate` and billing the user for a setting
     * they believe is saving them money.
     */
    throw new UnsupportedStrategyError(
      'the contact_sheet image strategy arrives in Phase 5; use separate',
    );
  }

  return images.flatMap(labelled);
}

/**
 * The review prompt, ordered for prompt caching.
 *
 * Stable first — instructions, spec, criteria, reference and grade images — then the listing.
 * Reversing those two costs nothing on the first candidate of an item and everything on the rest,
 * because a prefix cache matches from the beginning and stops at the first byte that differs.
 */
export function buildReviewPrompt(input: ReviewPromptInput): PromptPart[] {
  const strategy = input.strategy ?? 'separate';
  const { stable, listing } = input;

  const parts: PromptPart[] = [
    { type: 'text', text: stable.instructions },
    { type: 'text', text: stable.specSummary },
    { type: 'text', text: stable.criteria },
    ...pack(stable.referenceImages, strategy),
    ...pack(stable.gradeImages ?? [], strategy),
    { type: 'text', text: listing.text },
    ...pack(listing.images, strategy),
  ];

  // An empty section would otherwise send a blank block — tokens spent saying nothing, and one
  // more thing between the cacheable prefix and the listing.
  return parts.filter((part) => part.type !== 'text' || part.text.trim() !== '');
}

/**
 * How many images a review would carry, for §7's running "images per review" count on the item
 * page — the number the UI nudges at six, because each one costs 1,000–1,500 input tokens.
 */
export function countImages(input: ReviewPromptInput): number {
  return (
    input.stable.referenceImages.length +
    (input.stable.gradeImages?.length ?? 0) +
    input.listing.images.length
  );
}
