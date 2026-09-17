/**
 * Runs the pre-filter fixtures against the model the `prefilter` role is actually configured to
 * use, and reports how many it got right (P1-09).
 *
 * Not a test: it spends money and needs a provider key, so it is a script you run deliberately.
 * P1-17 turns the same fixtures into a CI gate with two providers and a budget; until then this is
 * how "obvious misses are rejected and plausible listings pass, on the configured cheap model"
 * gets checked.
 *
 *   pnpm --filter @goodies-beacon/ai prefilter-check
 *   pnpm --filter @goodies-beacon/ai prefilter-check -- --model openai:gpt-5-nano
 *   pnpm --filter @goodies-beacon/ai prefilter-check -- --rpm 600
 *   pnpm --filter @goodies-beacon/ai prefilter-check -- --budget 0.05
 *
 * The role's model comes from Settings in the database. `--model` overrides it for one run,
 * which is how you compare two before changing what the instance uses.
 *
 * `--rpm` is the request rate. The default is slow enough for a provider's free tier — Gemini's
 * gives 15 a minute — because a check that trips a rate limit reports the cases it could not run
 * as failures of the prompt, which is a confusing thing to be handed. Raise it on a paid key.
 *
 * `--budget` is a ceiling in US dollars, checked before each call. Reaching it fails the run: the
 * cases it never asked about are not evidence that the prompt is fine.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createDb,
  createLogger,
  createPool,
  parseConfig,
  wantedSpecSchema,
} from '@goodies-beacon/core';
import { assertBudget, BudgetSpentError, type EvalRun, score, tally } from '../src/eval/score.js';
import { runPrefilter } from '../src/prefilter.js';
import { keyFor, notice, paced, parseCommon, reportSummary, withModel } from './eval-run.js';

const repoRoot = new URL('../../../.env', import.meta.url);
try {
  process.loadEnvFile(repoRoot);
} catch {
  // Already exported, or no .env; the checks below report what is missing either way.
}

/**
 * The real config parser rather than a handful of `process.env` reads, because the provider keys
 * it produces are the half that is easy to forget: `generateForRole` takes them as an argument,
 * and omitting it makes every `.env` key invisible and every call fail open — which looks exactly
 * like a missing key, and is how the first version of this script "ran" eighteen cases without
 * calling anything.
 */
let config: ReturnType<typeof parseConfig>;
try {
  config = parseConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { databaseUrl, secretKey } = config;

const options = parseCommon(process.argv, 12);

interface Case {
  id: string;
  spec: string;
  expect: 'plausible' | 'reject';
  why: string;
  title: string;
  description: string;
  /**
   * Set when the fixture is deliberately near the line, with the reason. Graded and reported like
   * any other case, but a disagreement does not fail the run.
   *
   * Some listings genuinely have two defensible answers — a bundle in which the wanted item is a
   * named part is the standing example — and a model at its default sampling temperature will
   * give both across runs. Asserting one of them measures the dice rather than the prompt, and a
   * gate that fails at random on a workflow that spends money is a gate that gets switched off.
   * Marking it keeps the case and its drift visible without making the build a coin toss.
   */
  borderline?: string;
}

const fixtures = fileURLToPath(new URL('../fixtures/prefilter-cases.json', import.meta.url));
const specs = fileURLToPath(new URL('../../core/src/domain/fixtures', import.meta.url));
const { cases } = JSON.parse(readFileSync(fixtures, 'utf8')) as { cases: Case[] };

const pool = createPool(databaseUrl);
const db = createDb(pool);
const logger = createLogger('warn');

/**
 * A missing provider key is a skip, not a failure: a fork has no secrets and must still get a
 * green build (P1-17). It has to be checked before anything runs, because `runPrefilter` fails
 * *open* — with no key it would report every listing as plausible, find no wrong discards and
 * look exactly like a pass.
 */
const key = await keyFor(db, 'prefilter', options, secretKey, config.ai);
if (!key.ok) {
  notice(`Pre-filter check skipped: ${key.why}.`);
  await pool.end();
  process.exit(0);
}

const using = key.model;

interface Outcome {
  entry: Case;
  plausible: boolean;
  reason: string;
  failedOpen: boolean;
  costUsd: number;
}

const outcomes: Outcome[] = [];
let stoppedShort: string | undefined;

await withModel(db, 'prefilter', options.model, secretKey, async () => {
  const seconds = Math.round((cases.length * options.spacingMs) / 1000);
  console.log(
    `Pre-filter check — ${cases.length} cases on ${using}, ${options.rpm}/min (~${seconds}s)\n`,
  );

  for (const [index, entry] of cases.entries()) {
    // Paced rather than fired off together: the free tiers this is most likely to be run against
    // are measured per minute, and a 429 here is indistinguishable in the output from a prompt
    // that failed.
    await paced(index, options.spacingMs);

    try {
      assertBudget(
        outcomes.reduce((total, outcome) => total + outcome.costUsd, 0),
        options.budgetUsd,
      );
    } catch (error) {
      if (!(error instanceof BudgetSpentError)) throw error;
      stoppedShort = error.message;
      console.log(`  ! stopped after ${outcomes.length} of ${cases.length}: ${error.message}`);
      break;
    }

    const spec = wantedSpecSchema.parse(
      JSON.parse(readFileSync(`${specs}/${entry.spec}.json`, 'utf8')),
    );

    const result = await runPrefilter(
      { db, logger, secretKey, env: config.ai },
      { listing: { title: entry.title, description: entry.description }, spec },
    );

    outcomes.push({ entry, ...result });

    const wanted = entry.expect === 'plausible';
    const mark = result.failedOpen ? '!' : result.plausible === wanted ? '✓' : '✗';
    console.log(
      `  ${mark} ${entry.id.padEnd(28)} ${result.plausible ? 'plausible' : 'reject   '}  ${result.reason}`,
    );
  }
});

const graded = outcomes.filter((outcome) => !outcome.failedOpen);
const correct = graded.filter(
  (outcome) => outcome.plausible === (outcome.entry.expect === 'plausible'),
);

/**
 * The two mistakes are not equally bad, so they are reported apart rather than as one accuracy
 * figure. A listing wrongly discarded is never reviewed and never noticed; one wrongly kept costs
 * a fraction of a penny and the reviewer catches it. §7 asks this stage to discard 60–70% of a
 * targeted query's candidates, which is a rate to reach *without* wrong discards, not instead of.
 *
 * In precision and recall, keeping is the positive class — so **recall is the number that must be
 * 1.0** and precision is the one worth watching drift on.
 */
const wrong = graded.filter(
  (outcome) => outcome.plausible !== (outcome.entry.expect === 'plausible'),
);
const wronglyDiscarded = wrong.filter(
  (outcome) => outcome.entry.expect === 'plausible' && !outcome.entry.borderline,
);
const wronglyKept = wrong.filter(
  (outcome) => outcome.entry.expect === 'reject' && !outcome.entry.borderline,
);
const disagreed = wrong.filter((outcome) => outcome.entry.borderline);
const spent = outcomes.reduce((total, outcome) => total + outcome.costUsd, 0);
const couldNotRun = outcomes.length - graded.length + (cases.length - outcomes.length);

const measured = score(
  tally(
    graded.map((outcome) => ({
      expected: outcome.entry.expect === 'plausible',
      actual: outcome.plausible,
    })),
  ),
);

console.log(`\n  ${correct.length}/${graded.length} correct on ${using}`);
console.log(
  `  precision: ${measured.precision === null ? '—' : (measured.precision * 100).toFixed(1)}%` +
    `   recall: ${measured.recall === null ? '—' : (measured.recall * 100).toFixed(1)}%`,
);
console.log(`  wrongly discarded: ${wronglyDiscarded.length}  (the mistake that hides)`);
console.log(`  wrongly kept:      ${wronglyKept.length}  (the cheap mistake)`);
if (disagreed.length > 0) {
  console.log(`  borderline:        ${disagreed.length}  (reported, not a failure)`);
}
console.log(`  spent:             $${spent.toFixed(5)}`);

if (couldNotRun > 0) console.log(`  could not run:     ${couldNotRun}`);

for (const outcome of wronglyDiscarded) {
  console.log(
    `\n  DISCARDED "${outcome.entry.title}"\n    expected plausible: ${outcome.entry.why}\n    model said: ${outcome.reason}`,
  );
}
for (const outcome of disagreed) {
  console.log(
    `\n  BORDERLINE "${outcome.entry.title}"\n    expected ${outcome.entry.expect}: ${outcome.entry.borderline}\n    model said: ${outcome.reason}`,
  );
}
for (const outcome of wronglyKept) {
  console.log(
    `\n  KEPT "${outcome.entry.title}"\n    expected reject: ${outcome.entry.why}\n    model said: ${outcome.reason}`,
  );
}

/**
 * A wrong discard fails the run; a wrong keep is reported and tolerated, which is the same
 * asymmetry the prompt is written around.
 *
 * A case that could not be run fails it too — see the skip above for why an unreachable model
 * cannot be told from a pass by looking at the results.
 */
const fatal: string[] = [];
for (const outcome of wronglyDiscarded) {
  fatal.push(`discarded ${outcome.entry.id}, which should have been kept: ${outcome.entry.why}`);
}
if (couldNotRun > 0) {
  fatal.push(
    `${couldNotRun} case(s) could not be run; the pre-filter fails open, so this is not a pass`,
  );
}
if (stoppedShort) fatal.push(stoppedShort);

const run: EvalRun = {
  role: 'prefilter',
  model: using,
  score: measured,
  couldNotRun,
  spentUsd: spent,
  failures: [
    ...wronglyKept.map((outcome) => `kept ${outcome.entry.id}: ${outcome.reason}`),
    ...disagreed.map(
      (outcome) =>
        `borderline — ${outcome.entry.id} came back ` +
        `${outcome.plausible ? 'plausible' : 'reject'}: ${outcome.entry.borderline}`,
    ),
  ],
  fatal,
};

reportSummary([run]);
await pool.end();

if (fatal.length > 0) console.error(`\n${fatal.join('\n')}`);
process.exit(fatal.length > 0 ? 1 : 0);
