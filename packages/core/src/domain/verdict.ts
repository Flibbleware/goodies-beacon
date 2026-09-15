import { z } from 'zod';
import { CRITERION_RESULTS, SHIPS_TO_UK, VERDICT_DECISIONS } from './constants.js';

/**
 * What the reviewer returns, and what the decision rules turn it into (§7 steps 5 and 6).
 *
 * The reviewer never outputs a decision. It reports per-criterion evidence and the deterministic
 * function in P1-11 decides, so "why was this rejected" is always answerable from the rules
 * rather than from a model's mood. `reviewerOutputSchema` is what `generateObject` is held to;
 * `verdictSchema` is the assembled verdict once the rules have decided — the stored columns plus
 * the derived `reasons`, which is not one of them.
 *
 * **Every field a model fills in is required, and none of them carries a `.default()`.** A
 * default makes a field optional, an optional field is left out of the JSON Schema's `required`
 * list, and OpenAI's structured output refuses a schema whose `required` does not name every
 * property: *"'required' is required to be supplied and to be an array including every key in
 * properties"*. Gemini accepts the same schema happily, so a default here is a field that works
 * on one provider and fails on another — which would make §9's "switching providers is a settings
 * change" untrue. `schemas.test.ts` asserts it for every model-facing schema so the next one
 * cannot reintroduce it.
 *
 * Optionality is expressed as `nullable` instead, which is required-but-may-be-null and portable.
 */

export const criterionResultSchema = z.object({
  criterionId: z.string().min(1),
  result: z.enum(CRITERION_RESULTS),
  /** One line saying what in the listing settled it — shown per criterion in the UI (§8). */
  evidence: z.string(),
});

export const reviewerOutputSchema = z.object({
  criteriaResults: z.array(criterionResultSchema),
  /** Also the translation: a Japanese listing is summarised into English here (§7 step 5). */
  englishSummary: z.string(),
  shipsToUk: z.enum(SHIPS_TO_UK),
  /** Null until grading scales arrive in Phase 5, so nullable rather than defaulted. */
  grade: z.string().nullable(),
});

export const prefilterOutputSchema = z.object({
  plausible: z.boolean(),
  reason: z.string(),
});

/**
 * A verdict as the rest of the system uses it, once P1-11's rules have decided. Not a model
 * contract — it is built in code and read back from the database — so a default is safe here in a
 * way it is not above.
 *
 * **It is not the shape of the `verdicts` row.** The table's `reason` is singular and is the
 * `REJECTION_REASONS` enum for a hard-filter rejection (§7 step 2), null when the reviewer
 * decided. There is no column for the plural `reasons` below and deliberately so: see it.
 */
export const verdictSchema = reviewerOutputSchema.extend({
  decision: z.enum(VERDICT_DECISIONS),
  /**
   * Why the rules landed there, in the order §7 step 6 applies them.
   *
   * **Derived, never stored.** `decideVerdict` is a pure function of the spec version and the
   * per-criterion results, and both of those *are* stored — the spec version immutably — so
   * re-running it reproduces the reasons exactly, for ever, for nothing. A column would be a
   * second copy of something already implied, free to drift from the rules that wrote it the
   * first time the wording of a reason changes.
   *
   * That holds as long as every input is recoverable from the row. It is today. When Phase 5
   * attaches grading scales, a verdict must reference a scale *version* rather than a scale, or
   * editing a scale silently rewrites the explanation of every verdict judged under the old one.
   * §4 already versions scales "so a verdict can name the grade images it saw"; this is the same
   * requirement arriving from the other direction.
   */
  reasons: z.array(z.string()).default([]),
});

/** The schemas handed to a model, which `schemas.test.ts` holds to the portable subset. */
export const MODEL_OUTPUT_SCHEMAS = {
  prefilter: prefilterOutputSchema,
  reviewer: reviewerOutputSchema,
} as const;

export type CriterionResultEntry = z.infer<typeof criterionResultSchema>;
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;
export type PrefilterOutput = z.infer<typeof prefilterOutputSchema>;
export type VerdictResult = z.infer<typeof verdictSchema>;
