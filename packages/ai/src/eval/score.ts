/**
 * Scoring a prompt evaluation run, and saying what it found (P1-17).
 *
 * Pure on purpose. Everything here is arithmetic over outcomes a caller has already collected, so
 * the half of the eval that decides whether a run passed can be tested for nothing, while the half
 * that spends money is a script. A gate whose own scoring is untested is a gate that can fail
 * quietly in either direction.
 */

/** One binary classification, counted the way §7's asymmetry asks it to be. */
export interface Confusion {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
}

export const EMPTY: Confusion = {
  truePositives: 0,
  falsePositives: 0,
  trueNegatives: 0,
  falseNegatives: 0,
};

export function tally(outcomes: readonly { expected: boolean; actual: boolean }[]): Confusion {
  const result = { ...EMPTY };

  for (const { expected, actual } of outcomes) {
    if (expected && actual) result.truePositives += 1;
    else if (!expected && actual) result.falsePositives += 1;
    else if (!expected && !actual) result.trueNegatives += 1;
    else result.falseNegatives += 1;
  }

  return result;
}

/**
 * Precision and recall, with nothing invented when there is nothing to divide by.
 *
 * Null rather than 0 or 1 for an empty denominator: a run whose fixtures contained no positives
 * has *not* achieved perfect recall, and reporting 1.0 would turn a fixture set that had lost its
 * positive cases into a green tick. The caller decides what to do about a null; the arithmetic
 * refuses to guess.
 */
export interface Score extends Confusion {
  precision: number | null;
  recall: number | null;
  /** Everything classified, right or wrong. */
  total: number;
}

export function score(confusion: Confusion): Score {
  const predicted = confusion.truePositives + confusion.falsePositives;
  const actual = confusion.truePositives + confusion.falseNegatives;

  return {
    ...confusion,
    precision: predicted === 0 ? null : confusion.truePositives / predicted,
    recall: actual === 0 ? null : confusion.truePositives / actual,
    total:
      confusion.truePositives +
      confusion.falsePositives +
      confusion.trueNegatives +
      confusion.falseNegatives,
  };
}

export interface EvalRun {
  /** What was evaluated: `prefilter` or `reviewer`. */
  role: string;
  /** `provider:model`, so a summary names what actually answered. */
  model: string;
  score: Score;
  /** Cases the model could not be asked about at all — never averaged away (§9). */
  couldNotRun: number;
  spentUsd: number;
  /** The failures worth reading, already rendered to a line each. */
  failures: string[];
  /**
   * Why the run failed, or an empty array when it passed. Kept apart from `failures` because a
   * run can carry tolerated mistakes and still pass — §7's asymmetry is the whole point.
   */
  fatal: string[];
}

const percent = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(1)}%`;

/**
 * The job summary (P1-17). Markdown, because GitHub renders `$GITHUB_STEP_SUMMARY` as such and a
 * table is the one place these numbers are worth comparing across providers at a glance.
 */
export function markdownSummary(runs: readonly EvalRun[]): string {
  const lines: string[] = ['## Prompt evaluation', ''];

  lines.push('| Role | Model | Precision | Recall | Cases | Could not run | Spent |');
  lines.push('|---|---|---:|---:|---:|---:|---:|');

  for (const run of runs) {
    lines.push(
      `| ${run.role} | \`${run.model}\` | ${percent(run.score.precision)} | ` +
        `${percent(run.score.recall)} | ${run.score.total} | ${run.couldNotRun} | ` +
        `$${run.spentUsd.toFixed(4)} |`,
    );
  }

  const spent = runs.reduce((total, run) => total + run.spentUsd, 0);
  lines.push('', `Total spent: **$${spent.toFixed(4)}**`);

  for (const run of runs) {
    if (run.failures.length === 0 && run.fatal.length === 0) continue;

    lines.push('', `### ${run.role} on \`${run.model}\``);
    for (const reason of run.fatal) lines.push(`- **${reason}**`);
    for (const failure of run.failures) lines.push(`- ${failure}`);
  }

  if (runs.every((run) => run.fatal.length === 0)) {
    lines.push('', 'Every run passed.');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * A spend ceiling for one run (§9's "a small budget", P1-17).
 *
 * Checked before each call rather than after, because the point is not to notice afterwards that
 * a loop went wrong — it is to stop. A run that stops here fails: the cases it never asked about
 * are not evidence that the prompt is fine.
 */
export class BudgetSpentError extends Error {
  override readonly name = 'BudgetSpentError';
  constructor(
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(
      `the evaluation budget of $${budgetUsd.toFixed(2)} is spent ($${spentUsd.toFixed(4)}); ` +
        'the remaining cases were not run',
    );
  }
}

export function assertBudget(spentUsd: number, budgetUsd: number | null): void {
  if (budgetUsd !== null && spentUsd >= budgetUsd) {
    throw new BudgetSpentError(spentUsd, budgetUsd);
  }
}

/** Japanese, Chinese and Korean blocks — what an untranslated summary comes back full of. */
const CJK = /[　-ヿ㐀-鿿豈-﫿＀-￯]/;

/**
 * At most this share of a summary may be CJK before it stops counting as English.
 *
 * A threshold rather than "any at all", because those are two different failures and only one of
 * them matters. §7 step 5 makes the English summary the translation, and an untranslated one is
 * essentially all Japanese — while a summary that is English apart from a quoted term, a model
 * name or the seller's own word for the condition is doing its job, arguably better than one that
 * paraphrases the quote away. The gate flagged the second kind once and not the next time, which
 * made it a coin toss rather than a check.
 */
export const CJK_SHARE_LIMIT = 0.1;

export interface EnglishSummary {
  english: boolean;
  /** The distinct CJK characters found, for a failure message that points at the actual problem. */
  found: string[];
  share: number;
}

export function summaryIsEnglish(summary: string): EnglishSummary {
  const characters = [...summary];
  const cjk = characters.filter((character) => CJK.test(character));
  const share = characters.length === 0 ? 0 : cjk.length / characters.length;

  return { english: share <= CJK_SHARE_LIMIT, found: [...new Set(cjk)], share };
}
