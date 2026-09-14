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
 *
 * The role's model comes from Settings in the database. `--model` overrides it for one run,
 * which is how you compare two before changing what the instance uses.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createDb,
  createLogger,
  createPool,
  parseModelRef,
  readSettings,
  wantedSpecSchema,
  writeSettings,
} from '@goodies-beacon/core';
import { runPrefilter } from '../src/prefilter.js';

const repoRoot = new URL('../../../.env', import.meta.url);
try {
  process.loadEnvFile(repoRoot);
} catch {
  // Already exported, or no .env; the checks below report what is missing either way.
}

const databaseUrl = process.env.DATABASE_URL;
const secretKey = process.env.GOODIES_BEACON_SECRET_KEY;
if (!databaseUrl || !secretKey) {
  console.error('DATABASE_URL and GOODIES_BEACON_SECRET_KEY must be set; see .env.example.');
  process.exit(1);
}

const overrideAt = process.argv.indexOf('--model');
const override = overrideAt === -1 ? undefined : process.argv[overrideAt + 1];
if (override && !parseModelRef(override)) {
  console.error(`--model must be provider:model, such as openai:gpt-5-nano. Got: ${override}`);
  process.exit(1);
}

interface Case {
  id: string;
  spec: string;
  expect: 'plausible' | 'reject';
  why: string;
  title: string;
  description: string;
}

const fixtures = fileURLToPath(new URL('../fixtures/prefilter-cases.json', import.meta.url));
const specs = fileURLToPath(new URL('../../core/src/domain/fixtures', import.meta.url));
const { cases } = JSON.parse(readFileSync(fixtures, 'utf8')) as { cases: Case[] };

const pool = createPool(databaseUrl);
const db = createDb(pool);
const logger = createLogger('warn');

/**
 * The override is written to Settings for the run and put back afterwards, because the role is
 * read from the database by design — there is no way to pass a model down without giving the
 * pipeline a second, test-only path through it, which would then be the thing under test.
 */
const before = await readSettings(db);
if (override) {
  await writeSettings(db, { ai: { roles: { prefilter: override } } }, secretKey);
}
const using = (await readSettings(db)).ai.roles.prefilter;

interface Outcome {
  entry: Case;
  plausible: boolean;
  reason: string;
  failedOpen: boolean;
  costUsd: number;
}

const outcomes: Outcome[] = [];

try {
  console.log(`Pre-filter check — ${cases.length} cases on ${using}\n`);

  for (const entry of cases) {
    const spec = wantedSpecSchema.parse(
      JSON.parse(readFileSync(`${specs}/${entry.spec}.json`, 'utf8')),
    );

    const result = await runPrefilter(
      { db, logger, secretKey },
      {
        listing: { title: entry.title, description: entry.description },
        spec,
      },
    );

    outcomes.push({ entry, ...result });

    const wanted = entry.expect === 'plausible';
    const mark = result.failedOpen ? '!' : result.plausible === wanted ? '✓' : '✗';
    console.log(
      `  ${mark} ${entry.id.padEnd(28)} ${result.plausible ? 'plausible' : 'reject   '}  ${result.reason}`,
    );
  }
} finally {
  if (override) {
    await writeSettings(db, { ai: { roles: { prefilter: before.ai.roles.prefilter } } }, secretKey);
  }
}

const graded = outcomes.filter((outcome) => !outcome.failedOpen);
const correct = graded.filter(
  (outcome) => outcome.plausible === (outcome.entry.expect === 'plausible'),
);

/**
 * The two mistakes are not equally bad, so they are reported apart rather than as one accuracy
 * figure. A listing wrongly discarded is never reviewed and never noticed; one wrongly kept costs
 * a fraction of a penny and the reviewer catches it. §7 asks this stage to discard 60–70% of a
 * targeted query's candidates, which is a rate to reach *without* wrong discards, not instead of.
 */
const wronglyDiscarded = graded.filter(
  (outcome) => outcome.entry.expect === 'plausible' && !outcome.plausible,
);
const wronglyKept = graded.filter(
  (outcome) => outcome.entry.expect === 'reject' && outcome.plausible,
);
const spent = outcomes.reduce((total, outcome) => total + outcome.costUsd, 0);

console.log(`\n  ${correct.length}/${graded.length} correct on ${using}`);
console.log(`  wrongly discarded: ${wronglyDiscarded.length}  (the mistake that hides)`);
console.log(`  wrongly kept:      ${wronglyKept.length}  (the cheap mistake)`);
console.log(`  spent:             $${spent.toFixed(5)}`);

if (outcomes.length !== graded.length) {
  console.log(`  could not run:     ${outcomes.length - graded.length}`);
}

for (const outcome of wronglyDiscarded) {
  console.log(
    `\n  DISCARDED "${outcome.entry.title}"\n    expected plausible: ${outcome.entry.why}\n    model said: ${outcome.reason}`,
  );
}
for (const outcome of wronglyKept) {
  console.log(
    `\n  KEPT "${outcome.entry.title}"\n    expected reject: ${outcome.entry.why}\n    model said: ${outcome.reason}`,
  );
}

await pool.end();

/**
 * A wrong discard fails the run; a wrong keep is reported and tolerated, which is the same
 * asymmetry the prompt is written around.
 *
 * A case that could not be run fails it too. `runPrefilter` fails *open* by design — an
 * unreachable model keeps the listing — so without this a check with no API key configured would
 * report every case as plausible, find no wrong discards, and exit 0 looking like a pass.
 */
const couldNotRun = outcomes.length - graded.length;
if (couldNotRun > 0) {
  console.error(
    `\n${couldNotRun} case(s) could not be run — the pre-filter fails open, so this is not a pass.`,
  );
}

process.exit(wronglyDiscarded.length > 0 || couldNotRun > 0 ? 1 : 0);
