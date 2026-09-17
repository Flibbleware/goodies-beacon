/**
 * Runs the reviewer fixtures against the model the `reviewer` role is actually configured to use,
 * and reports how many criteria it got right (P1-10).
 *
 * Not a test: it spends money and needs a provider key, so it is a script you run deliberately.
 * P1-17 turns the same fixtures into a CI gate with two providers and a budget; until then this is
 * how "a clear pass, a clear hard fail, an unknown, and a Japanese listing" gets checked against a
 * real model.
 *
 *   pnpm --filter @goodies-beacon/ai reviewer-check
 *   pnpm --filter @goodies-beacon/ai reviewer-check -- --model google:gemini-3.1-flash
 *   pnpm --filter @goodies-beacon/ai reviewer-check -- --rpm 600
 *   pnpm --filter @goodies-beacon/ai reviewer-check -- --budget 0.20
 *
 * The role's model comes from Settings in the database. `--model` overrides it for one run, which
 * is how you compare two before changing what the instance uses.
 *
 * A review is several times the size of a pre-filter call, so this costs more than
 * `prefilter-check` — a few pence rather than a fraction of one.
 *
 * `--rpm` is the request rate, and the default is *four*, slower than `prefilter-check`'s twelve.
 * The free tiers are per model and the reviewer-tier ones are much tighter than the cheap models:
 * Gemini 3.8 Flash allows five requests a minute, so a run at ten reports three quarters of its
 * cases as failures of the model. Raise it on a paid key.
 *
 * `--budget` is a ceiling in US dollars, checked before each call. Reaching it fails the run: the
 * cases it never asked about are not evidence that the prompt is fine.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CriterionResult,
  createDb,
  createLogger,
  createPool,
  decideVerdict,
  parseConfig,
  type ShipsToUk,
  wantedSpecSchema,
} from '@goodies-beacon/core';
import {
  assertBudget,
  BudgetSpentError,
  CJK_SHARE_LIMIT,
  type EvalRun,
  score,
  summaryIsEnglish,
  tally,
} from '../src/eval/score.js';
import { runReviewer } from '../src/reviewer.js';
import { keyFor, notice, paced, parseCommon, reportSummary, withModel } from './eval-run.js';

const repoRoot = new URL('../../../.env', import.meta.url);
try {
  process.loadEnvFile(repoRoot);
} catch {
  // Already exported, or no .env; the checks below report what is missing either way.
}

/**
 * The real config parser rather than a handful of `process.env` reads: the provider keys it
 * produces are the half that is easy to forget, and omitting them makes every `.env` key invisible
 * and every call fail — which looks exactly like a missing key. See `prefilter-check.ts`, where
 * that mistake shipped once already.
 */
let config: ReturnType<typeof parseConfig>;
try {
  config = parseConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { databaseUrl, secretKey } = config;

const options = parseCommon(process.argv, 4);

interface Case {
  id: string;
  spec: string;
  why: string;
  title: string;
  description: string;
  images: { file: string; label: string }[];
  expect: {
    criteria: Record<string, CriterionResult>;
    shipsToUk: ShipsToUk;
    summaryMentions: string[];
    summaryInEnglish?: boolean;
  };
  /**
   * Criteria this case grades and reports but will not fail the run over, with the reason.
   *
   * Some criteria genuinely have two defensible answers for a given listing — usually because the
   * criterion bundles several tests and the seller addresses one of them — and a model at its
   * default sampling temperature gives both across runs. Asserting one measures the dice rather
   * than the prompt. A criterion that needs this is a criterion worth splitting in the spec; the
   * marking says which ones, so the list is a to-do rather than a shrug.
   */
  borderlineCriteria?: Record<string, string>;
}

const fixtures = fileURLToPath(new URL('../fixtures/reviewer-cases.json', import.meta.url));
const specs = fileURLToPath(new URL('../../core/src/domain/fixtures', import.meta.url));
const { cases } = JSON.parse(readFileSync(fixtures, 'utf8')) as { cases: Case[] };

const pool = createPool(databaseUrl);
const db = createDb(pool);
const logger = createLogger('warn');

/**
 * A missing provider key is a skip, not a failure: a fork has no secrets and must still get a
 * green build (P1-17). Checked before anything runs so a skip cannot be mistaken for a pass.
 */
const key = await keyFor(db, 'reviewer', options, secretKey, config.ai);
if (!key.ok) {
  notice(`Reviewer check skipped: ${key.why}.`);
  await pool.end();
  process.exit(0);
}

const using = key.model;

interface Wrong {
  entry: Case;
  what: string;
  expected: string;
  got: string;
  /** Present when the case marked this criterion as having two defensible answers. */
  borderline?: string;
}

const wrong: Wrong[] = [];
/** Graded and reported, but not fatal — see `borderlineCriteria`. */
const soft: Wrong[] = [];
const failed: { entry: Case; error: string }[] = [];
/** Expected against actual *decision*, so the run is scored on what the collector would see. */
const decisions: { expected: boolean; actual: boolean }[] = [];
let checks = 0;
let spent = 0;
let stoppedShort: string | undefined;

await withModel(db, 'reviewer', options.model, secretKey, async () => {
  console.log(
    `Reviewer check — ${cases.length} cases on ${using}, ${options.rpm}/min ` +
      `(~${Math.round((cases.length * options.spacingMs) / 1000)}s)\n`,
  );

  for (const [index, entry] of cases.entries()) {
    // Paced rather than fired off together: the free tiers this is most likely to be run against
    // are measured per minute, and a 429 here is indistinguishable in the output from a bad answer.
    await paced(index, options.spacingMs);

    try {
      assertBudget(spent, options.budgetUsd);
    } catch (error) {
      if (!(error instanceof BudgetSpentError)) throw error;
      stoppedShort = error.message;
      console.log(`  ! stopped after ${index} of ${cases.length}: ${error.message}`);
      break;
    }

    const spec = wantedSpecSchema.parse(
      JSON.parse(readFileSync(`${specs}/${entry.spec}.json`, 'utf8')),
    );

    let result: Awaited<ReturnType<typeof runReviewer>>;
    try {
      result = await runReviewer(
        { db, logger, secretKey, env: config.ai },
        { listing: { title: entry.title, description: entry.description }, spec },
      );
    } catch (error) {
      // The reviewer fails loudly by design, so a case that could not be run is a failure of the
      // run and not something to quietly average away.
      failed.push({ entry, error: error instanceof Error ? error.message : String(error) });
      console.log(`  ! ${entry.id.padEnd(32)} could not be run`);
      continue;
    }

    spent += result.costUsd;
    const wrongBefore = wrong.length;
    const byId = new Map(result.criteriaResults.map((item) => [item.criterionId, item]));

    for (const [criterionId, expected] of Object.entries(entry.expect.criteria)) {
      checks += 1;
      const got = byId.get(criterionId)?.result ?? 'missing';
      if (got !== expected) {
        const borderline = entry.borderlineCriteria?.[criterionId];
        (borderline ? soft : wrong).push({
          entry,
          what: criterionId,
          expected,
          got,
          ...(borderline ? { borderline } : {}),
        });
      }
    }

    checks += 1;
    if (result.shipsToUk !== entry.expect.shipsToUk) {
      wrong.push({
        entry,
        what: 'shipsToUk',
        expected: entry.expect.shipsToUk,
        got: result.shipsToUk,
      });
    }

    for (const phrase of entry.expect.summaryMentions) {
      checks += 1;
      if (!result.englishSummary.toLowerCase().includes(phrase.toLowerCase())) {
        wrong.push({
          entry,
          what: `summary mentions "${phrase}"`,
          expected: 'mentioned',
          got: 'no',
        });
      }
    }

    // §7 step 5 makes the English summary the translation, so a Japanese listing summarised in
    // Japanese is exactly the failure that case exists to catch. `summaryIsEnglish` is what
    // decides, and why it is a share rather than "any at all" is documented there.
    if (entry.expect.summaryInEnglish) {
      checks += 1;
      const english = summaryIsEnglish(result.englishSummary);
      if (!english.english) {
        wrong.push({
          entry,
          what: 'summary in English',
          expected: `at most ${Math.round(CJK_SHARE_LIMIT * 100)}% Japanese characters`,
          got: `${Math.round(english.share * 100)}% (${english.found.join('')})`,
        });
      }
    }

    /**
     * Scored on the *decision*, not only on the criteria, because that is what reaches the
     * collector. Both sides go through P1-11's rules — the expectation as written in the fixture
     * and the model's actual answers — so precision and recall measure the prompt against the
     * product's own output rather than against a second opinion about what the rules would say.
     *
     * Surfacing is the positive class: a match or an uncertain is emailed, a rejection is not.
     */
    const surfaced = (results: { criterionId: string; result: CriterionResult }[]): boolean =>
      decideVerdict({
        criteria: spec.criteria,
        settings: spec.settings,
        criteriaResults: results.map((item) => ({ ...item, evidence: '' })),
      }).decision !== 'reject';

    decisions.push({
      expected: surfaced(
        Object.entries(entry.expect.criteria).map(([criterionId, result]) => ({
          criterionId,
          result,
        })),
      ),
      actual: surfaced(result.criteriaResults),
    });

    const mark = wrong.length === wrongBefore ? '✓' : '✗';
    console.log(`  ${mark} ${entry.id.padEnd(32)} ${result.englishSummary.slice(0, 60)}`);
  }
});

const measured = score(tally(decisions));

console.log(`\n  ${checks - wrong.length}/${checks} checks correct on ${using}`);
console.log(
  `  surfaced correctly — precision: ` +
    `${measured.precision === null ? '—' : (measured.precision * 100).toFixed(1)}%` +
    `   recall: ${measured.recall === null ? '—' : (measured.recall * 100).toFixed(1)}%`,
);
console.log(`  spent: $${spent.toFixed(5)}`);
if (soft.length > 0) console.log(`  borderline: ${soft.length} (reported, not a failure)`);

const couldNotRun = failed.length + (cases.length - decisions.length - failed.length);
if (couldNotRun > 0) console.log(`  could not run: ${couldNotRun}`);

for (const item of wrong) {
  console.log(
    `\n  ${item.entry.id} — ${item.what}\n    expected: ${item.expected}\n    got:      ${item.got}\n    why the case exists: ${item.entry.why}`,
  );
}
for (const item of soft) {
  console.log(
    `\n  BORDERLINE ${item.entry.id} — ${item.what}\n    expected: ${item.expected}\n    got:      ${item.got}\n    why it is borderline: ${item.borderline}`,
  );
}
for (const item of failed) {
  console.log(`\n  ${item.entry.id} could not be run: ${item.error}`);
}

const fatal: string[] = [
  ...wrong.map(
    (item) => `${item.entry.id} — ${item.what}: expected ${item.expected}, got ${item.got}`,
  ),
  ...failed.map((item) => `${item.entry.id} could not be run: ${item.error}`),
];
if (stoppedShort) fatal.push(stoppedShort);

const run: EvalRun = {
  role: 'reviewer',
  model: using,
  score: measured,
  couldNotRun,
  spentUsd: spent,
  failures: soft.map(
    (item) =>
      `borderline — ${item.entry.id} ${item.what}: expected ${item.expected}, got ${item.got}`,
  ),
  fatal,
};

reportSummary([run]);
await pool.end();

process.exit(fatal.length > 0 ? 1 : 0);
