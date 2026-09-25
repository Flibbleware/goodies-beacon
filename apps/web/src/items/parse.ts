import type { SpecWarning, WantedSpec } from '@goodies-beacon/core/schemas';
import {
  BUYING_TYPES,
  criterionSchema,
  lintSpec,
  searchPlanSchema,
  specSettingsSchema,
  wantedSpecSchema,
} from '@goodies-beacon/core/schemas';
import { z } from 'zod';

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

/**
 * The same document with every rule a half-typed value can break relaxed to its bare type, used
 * only to draw the form (P1-18).
 *
 * Clearing a criterion's text, or typing `PT8H` one character at a time, passes through values the
 * strict schema rightly refuses to save — `P` is not a duration and `0` is not a price. What it
 * must not do is take the form away while it is being typed in: the fields would unmount, the
 * caret would go, and the editor would drop to raw JSON at the exact moment someone least wants
 * it. So the form draws from this and shows the strict schema's issues beside the fields, the Save
 * button stays on `wantedSpecSchema`, and the relaxation is written here rather than weakening the
 * rule everything else depends on. Only the shape is still enforced: a string where a string goes.
 */
const draftSpecSchema = wantedSpecSchema.extend({
  settings: specSettingsSchema.extend({
    listingTypes: z.array(z.enum(BUYING_TYPES)).default([...BUYING_TYPES]),
    priceCeiling: z
      .object({ amount: z.number(), currency: z.literal('GBP') })
      .nullable()
      .default(null),
    gradingScaleId: z.string().nullable().default(null),
    negativeKeywords: z.array(z.string()).default([]),
    pollEvery: z.string().nullable().default(null),
  }),
  criteria: z.array(criterionSchema.extend({ text: z.string() })).default([]),
  searchPlans: z
    .array(searchPlanSchema.extend({ query: z.string(), region: z.string() }))
    .default([]),
});

export type SpecParse =
  | { ok: true; spec: WantedSpec; warnings: SpecWarning[] }
  /** `draft` is present when the document is close enough to draw, but not to save. */
  | { ok: false; issues: SpecIssue[]; draft?: WantedSpec; warnings?: SpecWarning[] };

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
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.map(String).join('.') : 'spec',
      message: issue.message,
    }));

    const draft = draftSpecSchema.safeParse(document);
    return draft.success
      ? { ok: false, issues, draft: draft.data, warnings: lintSpec(draft.data) }
      : { ok: false, issues };
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

/** A document the form can write to: an object, whatever else is wrong with it. */
export type SpecDocument = Record<string, unknown>;

/**
 * Applies an edit to the document behind the text and gives back the new text.
 *
 * The form reads from `parseSpecText`, whose result is normalised — every default filled in,
 * `watermark` and `addedAt` turned into Dates by `z.coerce.date`. Writing that back would rewrite
 * fields nobody touched and change two of them from strings into something `JSON.stringify` spells
 * differently. So reads come from the parsed spec and writes go through here, to the raw document,
 * which is the only copy that survives a round trip unchanged.
 *
 * Undefined when the text is not a JSON object: there is nothing to edit, and the form is not
 * shown in that state.
 */
export function withDocument(
  text: string,
  edit: (document: SpecDocument) => void,
): string | undefined {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return undefined;
  }

  const copy = structuredClone(document) as SpecDocument;
  edit(copy);
  return `${JSON.stringify(copy, null, 2)}\n`;
}

/**
 * The same, for a field of `settings`, creating the object if the document has no `settings` yet.
 *
 * A separate helper because every settings control would otherwise repeat the same four lines of
 * narrowing, and one of them getting it wrong would write a sibling of `settings` instead.
 */
export function withSetting(text: string, key: string, value: unknown): string | undefined {
  return withDocument(text, (document) => {
    const settings = document.settings;
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      document.settings = { [key]: value };
      return;
    }
    (settings as SpecDocument)[key] = value;
  });
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

/** Drops the reference image with this id from the document, leaving everything else as it was. */
export function withoutReferenceImage(text: string, id: string): string | undefined {
  return withDocument(text, (document) => {
    if (!Array.isArray(document.referenceImages)) return;
    document.referenceImages = document.referenceImages.filter(
      (entry) =>
        entry === null || typeof entry !== 'object' || (entry as { id?: unknown }).id !== id,
    );
  });
}
