import type { CriterionKind, OnUnknown, VerdictDecision } from './constants.js';
import type { SpecSettings } from './spec.js';
import type { CriterionResultEntry } from './verdict.js';

/**
 * The decision, and the only place one is made (ARCHITECTURE.md §7 step 6).
 *
 * The reviewer reports evidence and never decides. This does, deterministically, from the spec
 * version and the reviewer's per-criterion results — so "why was this rejected" is always
 * answerable from the rules rather than from a model's mood, and re-running it on the same inputs
 * gives the same answer for ever. It is a pure function: no database, no clock, no model.
 *
 * Rules, in the order §7 applies them:
 *
 * 1. any *hard* criterion `fail` → reject
 * 2. any *soft* criterion `fail` → uncertain
 * 3. any criterion `unknown` with `onUnknown = surface` → uncertain
 * 4. any criterion `unknown` with `onUnknown = reject` → reject
 * 5. grade below the minimum → reject; grade unknown → uncertain
 * 6. otherwise → match
 *
 * **The list is not in severity order, so every rule is evaluated and the worst outcome wins.**
 * Rule 2 yields uncertain and rule 4 yields reject, so stopping at the first rule that fires would
 * let a soft failure mask a hard one and email the collector a listing the rules meant to reject.
 * `reasons` is collected in the order above, which is the order a person reads them in.
 */

export interface Decision {
  decision: VerdictDecision;
  /** Why the rules landed there, in the order §7 step 6 applies them. Empty for a clean match. */
  reasons: string[];
}

/**
 * What the decision needs of a criterion. Structurally satisfied by `Criterion`, and looser on
 * purpose: `onUnknown` may be null or absent to mean "use the item's default" (see below).
 */
export interface DecidableCriterion {
  id: string;
  text: string;
  kind: CriterionKind;
  // `undefined` is spelled out because `exactOptionalPropertyTypes` distinguishes an absent
  // property from one explicitly set to undefined, and both mean "no opinion" here.
  onUnknown?: OnUnknown | null | undefined;
}

/** One grade on a scale (§4). Only the rank matters here; the rest is for the UI. */
export interface GradeRank {
  label: string;
  rank: number;
}

export interface DecisionInput {
  criteria: readonly DecidableCriterion[];
  settings: Pick<SpecSettings, 'defaultOnUnknown' | 'minimumGrade'>;
  /** The reviewer's output (§7 step 5). A criterion it did not answer counts as unknown. */
  criteriaResults: readonly CriterionResultEntry[];
  /** Null when the reviewer could not grade it, or when no scale is attached. */
  grade?: string | null;
  /**
   * The attached scale's grades, needed to compare `grade` against `minimumGrade`. Phase 5
   * attaches these; in Phase 1 there is no scale and the grade rules never fire.
   */
  gradingScale?: readonly GradeRank[] | null;
}

const SEVERITY: Record<VerdictDecision, number> = { match: 0, uncertain: 1, reject: 2 };

/**
 * What to do about an unknown on this criterion.
 *
 * The criterion's own setting wins; the item's `defaultOnUnknown` is the fallback. Note that a
 * spec parsed by `wantedSpecSchema` today always carries an explicit `onUnknown`, because the Zod
 * schema hard-defaults it to `surface` — so the item default is unreachable in practice until a
 * criterion can express "no opinion". That is a spec-schema decision belonging to the editor
 * (P1-13), and the fallback is written here so the rules do not have to change when it arrives.
 */
export function resolveOnUnknown(
  criterion: DecidableCriterion,
  settings: Pick<SpecSettings, 'defaultOnUnknown'>,
): OnUnknown {
  return criterion.onUnknown ?? settings.defaultOnUnknown;
}

/** Quotes a criterion for a reason line, shortened so one long criterion cannot fill the UI. */
function name(criterion: DecidableCriterion): string {
  const text = criterion.text.trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/**
 * Decide one candidate.
 *
 * A criterion with no result is treated as `unknown` rather than skipped, which is the safe
 * reading: §7 step 6 surfaces an unknown or rejects on it, where skipping it would let a silent
 * omission read as a pass. A result naming a criterion that is not in the spec is ignored, there
 * being no rule to apply it to. (P1-10's reviewer already reconciles both, so neither should
 * reach here from the pipeline; this function is the last line rather than the first.)
 */
export function decideVerdict(input: DecisionInput): Decision {
  const byId = new Map(input.criteriaResults.map((entry) => [entry.criterionId, entry]));
  const reasons: string[] = [];
  let decision: VerdictDecision = 'match';

  const worsen = (next: VerdictDecision, why: string) => {
    reasons.push(why);
    if (SEVERITY[next] > SEVERITY[decision]) decision = next;
  };

  const resultFor = (criterion: DecidableCriterion) => byId.get(criterion.id)?.result ?? 'unknown';

  for (const criterion of input.criteria) {
    if (criterion.kind === 'hard' && resultFor(criterion) === 'fail') {
      worsen('reject', `Hard criterion failed: ${name(criterion)}`);
    }
  }

  for (const criterion of input.criteria) {
    if (criterion.kind === 'soft' && resultFor(criterion) === 'fail') {
      worsen('uncertain', `Soft criterion failed: ${name(criterion)}`);
    }
  }

  for (const criterion of input.criteria) {
    if (
      resultFor(criterion) === 'unknown' &&
      resolveOnUnknown(criterion, input.settings) === 'surface'
    ) {
      worsen('uncertain', `Could not be established: ${name(criterion)}`);
    }
  }

  for (const criterion of input.criteria) {
    if (
      resultFor(criterion) === 'unknown' &&
      resolveOnUnknown(criterion, input.settings) === 'reject'
    ) {
      worsen(
        'reject',
        `Could not be established, and set to reject when unknown: ${name(criterion)}`,
      );
    }
  }

  gradeRules(input, worsen);

  return { decision, reasons };
}

/**
 * Rules 5: the grade, which only applies when the item sets a minimum.
 *
 * Anything that stops the grade being compared — no grade reported, no scale to rank it against,
 * or a label that is not on the scale — is treated as *unknown* and surfaced, never as a pass.
 * A minimum the instance cannot actually check is exactly the case the collector wants shown to
 * them rather than decided on their behalf.
 */
function gradeRules(
  input: DecisionInput,
  worsen: (next: VerdictDecision, why: string) => void,
): void {
  const minimum = input.settings.minimumGrade;
  if (!minimum) return;

  const scale = input.gradingScale ?? [];
  const wanted = scale.find((entry) => entry.label === minimum);
  const got = input.grade ? scale.find((entry) => entry.label === input.grade) : undefined;

  if (!wanted) {
    worsen('uncertain', `Grade could not be checked: "${minimum}" is not on the attached scale`);
    return;
  }

  if (!got) {
    worsen(
      'uncertain',
      input.grade
        ? `Grade could not be checked: "${input.grade}" is not on the attached scale`
        : 'Grade could not be established from the listing',
    );
    return;
  }

  if (got.rank < wanted.rank) {
    worsen('reject', `Grade ${got.label} is below the minimum of ${wanted.label}`);
  }
}
