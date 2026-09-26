import { z } from 'zod';
import type { CriterionKind, OnUnknown } from './constants.js';
import { CRITERION_KINDS, ON_UNKNOWN } from './constants.js';
import type { Criterion } from './spec.js';
import { matchesTag, tagsSchema } from './tags.js';

/**
 * Shared criteria (P1-27): one criterion written once — "the original release, not the Nintendo
 * Classics re-release" — and used by any number of wanted items.
 *
 * A spec never points at one and leaves the pipeline to look it up. It holds a full copy, marked
 * with the identifier it came from, because the pipeline reads the spec and nothing else and a
 * verdict must be explainable from the version that judged it (§4). Keeping the copies current is
 * the store's job: saving a shared criterion writes a new version on every item using it.
 */

export const SHARED_KEY_MAX_LENGTH = 60;

/**
 * Fixed once created. It is the criterion's id in every spec that uses it, and feedback is keyed on
 * that id, so a rename would detach an item's feedback from the criterion it was about.
 */
export const sharedCriterionKeySchema = z
  .string()
  .trim()
  .min(1, 'a shared criterion needs an identifier')
  .max(SHARED_KEY_MAX_LENGTH, `is at most ${SHARED_KEY_MAX_LENGTH} characters`)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'use lowercase letters, digits and single hyphens, like original-release-not-classics',
  );

/**
 * A field left null is chosen by each item that uses the criterion; one that is set is fixed on
 * all of them. The text is always fixed.
 */
const sharedFields = {
  text: z.string().trim().min(1, 'a criterion needs text').max(2000, 'is too long'),
  kind: z.enum(CRITERION_KINDS).nullable().default(null),
  quantifiable: z.boolean().nullable().default(null),
  onUnknown: z.enum(ON_UNKNOWN).nullable().default(null),
  tags: tagsSchema.default([]),
};

export const sharedCriterionCreateSchema = z.object({
  key: sharedCriterionKeySchema,
  ...sharedFields,
});

/** Strict, so an attempt to change the identifier is refused rather than quietly ignored. */
export const sharedCriterionUpdateSchema = z.strictObject(sharedFields);

export type SharedCriterionCreateInput = z.infer<typeof sharedCriterionCreateSchema>;
export type SharedCriterionUpdateInput = z.infer<typeof sharedCriterionUpdateSchema>;

/** What decides a linked criterion's contents: the identifier and the fields it fixes. */
export interface SharedCriterionFields {
  key: string;
  text: string;
  kind: CriterionKind | null;
  quantifiable: boolean | null;
  onUnknown: OnUnknown | null;
}

/** A shared criterion as the Criteria page lists it, with how many items use it. */
export interface SharedCriterion extends SharedCriterionFields {
  id: string;
  tags: string[];
  /** Wanted items whose current spec links it. */
  items: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The fields a shared criterion fixes on every criterion linked to it. Applied to a spec on every
 * save and to stored versions when the shared criterion changes, so the two cannot disagree.
 */
export function lockedFields(shared: SharedCriterionFields): Partial<Criterion> {
  return {
    id: shared.key,
    shared: shared.key,
    text: shared.text,
    ...(shared.kind === null ? {} : { kind: shared.kind }),
    ...(shared.quantifiable === null ? {} : { quantifiable: shared.quantifiable }),
    ...(shared.onUnknown === null ? {} : { onUnknown: shared.onUnknown }),
  };
}

/**
 * A new criterion linked to `shared`, for adding it to an item. What the shared criterion leaves
 * open starts where a new criterion of the item's own starts.
 */
export function linkedCriterion(
  shared: SharedCriterionFields,
  defaultOnUnknown: OnUnknown,
): Criterion {
  return {
    id: shared.key,
    text: shared.text,
    kind: 'soft',
    quantifiable: false,
    onUnknown: defaultOnUnknown,
    ...lockedFields(shared),
  };
}

/**
 * True when the identifier or any tag contains the query, ignoring case; an empty query matches
 * everything. Spaces match the identifier's hyphens, so "game boy" finds `game-boy-boxed`.
 */
export function matchesSharedCriterion(
  criterion: { key: string; tags: readonly string[] },
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return (
    needle === '' ||
    criterion.key.includes(needle.replace(/\s+/g, '-')) ||
    matchesTag(criterion.tags, needle)
  );
}
