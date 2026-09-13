import type { Criterion, WantedSpec } from './spec.js';

/**
 * One check on a spec's criteria, and deliberately only one.
 *
 * ARCHITECTURE.md §4 originally asked for a linter that also flagged criteria *mentioning* prices,
 * countries or listing types. That was dropped in v1.24, because it was guarding something that
 * is not actually loose: `priceCeiling` is `{ amount, currency: 'GBP' }`, `listingTypes` is an
 * enum, and a region is a field on the search plan. A price in a criterion is only reachable by
 * hand-typing one into P1-13's raw JSON editor, and both of Phase 3's deliverables close that —
 * the typed form gives the ceiling a number field, and `propose_spec` is typed so the interviewer
 * cannot express it. Matching English with regular expressions was never going to be the third
 * guard, and the false positives ("the £10 budget re-release") would have made the warnings noise.
 *
 * What survives is not pattern matching at all. It compares two typed fields, so it cannot
 * misfire, and it catches something genuinely easy to get wrong.
 *
 * A warning, never an error: §8 makes the tooling a convenience rather than a gatekeeper.
 */

export const LINT_CODES = ['hard_non_quantifiable'] as const;
export type LintCode = (typeof LINT_CODES)[number];

export interface SpecWarning {
  code: LintCode;
  criterionId: string;
  message: string;
}

/** Lints one criterion. Exported because P1-13 lints as you type, before a whole spec exists. */
export function lintCriterion(criterion: Criterion): SpecWarning[] {
  /**
   * `hard` sounds like the careful choice, which is the trap: a hard criterion rejects outright,
   * so one the evidence cannot settle definitively rejects on a blurry photo as readily as on a
   * real fault. `soft` surfaces it as uncertain instead, which is what requirement 8/9 asks for.
   * Legal, just unusual, so it is said rather than blocked.
   */
  if (criterion.kind === 'hard' && !criterion.quantifiable) {
    return [
      {
        code: 'hard_non_quantifiable',
        criterionId: criterion.id,
        message:
          'is hard but not quantifiable, so a listing the photos cannot settle is rejected outright rather than surfaced as uncertain. That is allowed; soft is usually what is meant',
      },
    ];
  }

  return [];
}

/** Every warning for a spec, in criteria order. An empty array means nothing to say. */
export function lintSpec(spec: Pick<WantedSpec, 'criteria'>): SpecWarning[] {
  return spec.criteria.flatMap(lintCriterion);
}
