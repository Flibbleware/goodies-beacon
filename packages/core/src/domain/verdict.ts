import { z } from 'zod';
import { CRITERION_RESULTS, SHIPS_TO_UK, VERDICT_DECISIONS } from './constants.js';

/**
 * What the reviewer returns, and what the decision rules turn it into (§7 steps 5 and 6).
 *
 * The reviewer never outputs a decision. It reports per-criterion evidence and the deterministic
 * function in P1-11 decides, so "why was this rejected" is always answerable from the rules
 * rather than from a model's mood. `reviewerOutputSchema` is what `generateObject` is held to;
 * `verdictSchema` is the stored row once a decision has been derived.
 */

export const criterionResultSchema = z.object({
  criterionId: z.string().min(1),
  result: z.enum(CRITERION_RESULTS),
  /** One line saying what in the listing settled it — shown per criterion in the UI (§8). */
  evidence: z.string().default(''),
});

export const reviewerOutputSchema = z.object({
  criteriaResults: z.array(criterionResultSchema),
  /** Also the translation: a Japanese listing is summarised into English here (§7 step 5). */
  englishSummary: z.string().default(''),
  shipsToUk: z.enum(SHIPS_TO_UK).default('unknown'),
  /** Null until grading scales arrive in Phase 5. */
  grade: z.string().nullable().default(null),
});

export const prefilterOutputSchema = z.object({
  plausible: z.boolean(),
  reason: z.string().default(''),
});

export const verdictSchema = reviewerOutputSchema.extend({
  decision: z.enum(VERDICT_DECISIONS),
  /** Why the rules landed there, in the order §7 step 6 applies them. */
  reasons: z.array(z.string()).default([]),
});

export type CriterionResultEntry = z.infer<typeof criterionResultSchema>;
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;
export type PrefilterOutput = z.infer<typeof prefilterOutputSchema>;
export type VerdictResult = z.infer<typeof verdictSchema>;
