import type { SpecWarning, WantedSpec } from '@goodies-beacon/core/schemas';
import { lintSpec, wantedSpecSchema } from '@goodies-beacon/core/schemas';

/**
 * Reading the spec editor's textarea (P1-13).
 *
 * The same `wantedSpecSchema` the API validates against, run in the browser as you type, so the
 * editor says exactly what a save would say rather than an approximation of it. Pure, and
 * deliberately so: it is the only part of the page worth testing without a browser.
 */

export interface SpecIssue {
  /** Dotted path into the document: `settings.priceCeiling.currency`, `criteria.2.text`. */
  path: string;
  message: string;
}

export type SpecParse =
  | { ok: true; spec: WantedSpec; warnings: SpecWarning[] }
  | { ok: false; issues: SpecIssue[] };

/** A valid document with nothing in it, so a new item starts from something that parses. */
export const STARTING_SPEC = `{
  "summary": "",
  "plausibilityNote": null,
  "settings": {
    "sources": ["ebay"],
    "listingTypes": ["auction", "fixed"],
    "priceCeiling": null,
    "shipsToUk": "show_all",
    "conditionCategory": "any",
    "gradingScaleId": null,
    "minimumGrade": null,
    "negativeKeywords": [],
    "notificationMode": "digest",
    "pollEvery": null,
    "relists": "show",
    "defaultOnUnknown": "surface",
    "backfill": { "enabled": false, "depth": "top_200" }
  },
  "criteria": [],
  "searchPlans": [],
  "referenceImages": [],
  "changeNote": null
}
`;

export function parseSpecText(text: string): SpecParse {
  if (text.trim() === '') {
    return { ok: false, issues: [{ path: 'spec', message: 'is empty' }] };
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    // Whatever the engine says about where it gave up is more useful than anything we could add.
    return {
      ok: false,
      issues: [{ path: 'JSON', message: error instanceof Error ? error.message : 'is not valid' }],
    };
  }

  const result = wantedSpecSchema.safeParse(document);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.map(String).join('.') : 'spec',
        message: issue.message,
      })),
    };
  }

  return { ok: true, spec: result.data, warnings: lintSpec(result.data) };
}

/** §4's `ReferenceImage`, before it has been through the schema that turns `addedAt` into a Date. */
export interface ReferenceImageEntry {
  id: string;
  path: string;
  label: string;
  addedAt: string | Date;
}

/**
 * Appends an uploaded reference image to the document's `referenceImages`.
 *
 * It re-serialises, which is why it happens on an explicit click and not on every upload: the
 * alternative is hand-editing a `{ id, path, label, addedAt }` object into the right array, and
 * losing someone's own formatting without being asked is worse than either.
 *
 * Undefined when the text is not JSON or has a `referenceImages` that is not an array — there is
 * nothing to append to, and saying so is better than rewriting what they typed.
 */
export function withReferenceImage(text: string, image: ReferenceImageEntry): string | undefined {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return undefined;
  }

  const existing = (document as Record<string, unknown>).referenceImages;
  if (existing !== undefined && !Array.isArray(existing)) return undefined;

  const referenceImages = [...(existing ?? []), image];
  return `${JSON.stringify({ ...document, referenceImages }, null, 2)}\n`;
}
