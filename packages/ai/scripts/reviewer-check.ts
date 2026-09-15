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
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CriterionResult,
  createDb,
  createLogger,
  createPool,
  parseConfig,
  parseModelRef,
  readSettings,
  type ShipsToUk,
  wantedSpecSchema,
  writeSettings,
} from '@goodies-beacon/core';
import { runReviewer } from '../src/reviewer.js';

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

const rpmAt = process.argv.indexOf('--rpm');
const rpm = rpmAt === -1 ? 4 : Number(process.argv[rpmAt + 1]);
if (!Number.isFinite(rpm) || rpm <= 0) {
  console.error(
    `--rpm must be a positive number of requests per minute. Got: ${process.argv[rpmAt + 1]}`,
  );
  process.exit(1);
}
const spacingMs = Math.ceil(60_000 / rpm);

const overrideAt = process.argv.indexOf('--model');
const override = overrideAt === -1 ? undefined : process.argv[overrideAt + 1];
if (override && !parseModelRef(override)) {
  console.error(`--model must be provider:model, such as openai:gpt-5-mini. Got: ${override}`);
  process.exit(1);
}

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
}

const fixtures = fileURLToPath(new URL('../fixtures/reviewer-cases.json', import.meta.url));
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
const settingsBefore = await readSettings(db);
if (override) {
  await writeSettings(db, { ai: { roles: { reviewer: override } } }, secretKey);
}
const using = (await readSettings(db)).ai.roles.reviewer;

/** Japanese, Chinese and Korean blocks — what an untranslated summary comes back full of. */
const CJK = /[　-ヿ㐀-鿿豈-﫿＀-￯]/;

interface Wrong {
  entry: Case;
  what: string;
  expected: string;
  got: string;
}

const wrong: Wrong[] = [];
const failed: { entry: Case; error: string }[] = [];
let checks = 0;
let spent = 0;

console.log(
  `Reviewer check — ${cases.length} cases on ${using}, ${rpm}/min ` +
    `(~${Math.round((cases.length * spacingMs) / 1000)}s)\n`,
);

let first = true;
for (const entry of cases) {
  // Paced rather than fired off together: the free tiers this is most likely to be run against are
  // measured per minute, and a 429 here is indistinguishable in the output from a bad answer.
  if (!first) await new Promise((resolve) => setTimeout(resolve, spacingMs));
  first = false;

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
    // The reviewer fails loudly by design, so a case that could not be run is a failure of the run
    // and not something to quietly average away.
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
    if (got !== expected) wrong.push({ entry, what: criterionId, expected, got });
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
      wrong.push({ entry, what: `summary mentions "${phrase}"`, expected: 'mentioned', got: 'no' });
    }
  }

  // §7 step 5 makes the English summary the translation, so a Japanese listing summarised in
  // Japanese is exactly the failure that case exists to catch.
  if (entry.expect.summaryInEnglish) {
    checks += 1;
    if (CJK.test(result.englishSummary)) {
      wrong.push({
        entry,
        what: 'summary in English',
        expected: 'English',
        got: result.englishSummary.slice(0, 40),
      });
    }
  }

  const mark = wrong.length === wrongBefore ? '✓' : '✗';
  console.log(`  ${mark} ${entry.id.padEnd(32)} ${result.englishSummary.slice(0, 60)}`);
}

if (override) {
  await writeSettings(
    db,
    { ai: { roles: { reviewer: settingsBefore.ai.roles.reviewer } } },
    secretKey,
  );
}

console.log(`\n  ${checks - wrong.length}/${checks} checks correct on ${using}`);
console.log(`  spent: $${spent.toFixed(5)}`);
if (failed.length > 0) console.log(`  could not run: ${failed.length}`);

for (const item of wrong) {
  console.log(
    `\n  ${item.entry.id} — ${item.what}\n    expected: ${item.expected}\n    got:      ${item.got}\n    why the case exists: ${item.entry.why}`,
  );
}
for (const item of failed) {
  console.log(`\n  ${item.entry.id} could not be run: ${item.error}`);
}

await pool.end();

process.exit(wrong.length > 0 || failed.length > 0 ? 1 : 0);
