/**
 * The parts of a prompt evaluation that are the same whichever role is being judged (P1-17).
 *
 * The two check scripts kept their own copies of argument parsing and pacing while they were the
 * only readers; a budget, a skip and a job summary are three more things that must behave
 * identically in both, so they live here rather than being written twice and drifting once.
 */

import { appendFileSync } from 'node:fs';
import {
  type AiKeys,
  type AiProvider,
  type Database,
  parseModelRef,
  readSettings,
  resolveAiProvider,
  writeSettings,
} from '@goodies-beacon/core';
import { type EvalRun, markdownSummary } from '../src/eval/score.js';

export interface CommonOptions {
  /** `provider:model`, or undefined to use whatever the role is set to in Settings. */
  model: string | undefined;
  rpm: number;
  spacingMs: number;
  /** Dollars this run may spend before it stops and fails. Null means no ceiling. */
  budgetUsd: number | null;
}

/**
 * Reads the flags both scripts take. Exits rather than throwing: these are scripts, and a bad
 * flag should say which one and stop, not produce a stack trace above a run that never happened.
 */
export function parseCommon(argv: readonly string[], defaultRpm: number): CommonOptions {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };

  const rawRpm = value('--rpm');
  const rpm = rawRpm === undefined ? defaultRpm : Number(rawRpm);
  if (!Number.isFinite(rpm) || rpm <= 0) {
    fail(`--rpm must be a positive number of requests per minute. Got: ${rawRpm}`);
  }

  const model = value('--model');
  if (model !== undefined && !parseModelRef(model)) {
    fail(`--model must be provider:model, such as openai:gpt-5-nano. Got: ${model}`);
  }

  const rawBudget = value('--budget');
  const budgetUsd = rawBudget === undefined ? null : Number(rawBudget);
  if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd <= 0)) {
    fail(`--budget must be a positive number of US dollars. Got: ${rawBudget}`);
  }

  return { model, rpm, spacingMs: Math.ceil(60_000 / rpm), budgetUsd };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Whether this run can be attempted at all, checked *before* any case is run.
 *
 * A fork has no provider secrets and must still get a green build (P1-17), so a missing key is a
 * skip rather than a failure. It cannot be detected from the results: the pre-filter fails open by
 * design, so a run with no key reports every listing as plausible, finds no wrong discards and
 * looks exactly like a pass. The key is therefore looked up first and the run never starts.
 */
export async function keyFor(
  db: Database,
  role: 'prefilter' | 'reviewer',
  options: CommonOptions,
  secretKey: string,
  env: AiKeys,
): Promise<{ ok: true; model: string } | { ok: false; model: string; why: string }> {
  const settings = await readSettings(db);
  const model = options.model ?? settings.ai.roles[role];
  const parsed = parseModelRef(model);

  if (!parsed) return { ok: false, model, why: `"${model}" is not provider:model` };

  const credential = resolveAiProvider(settings, parsed.provider as AiProvider, secretKey, env);
  if (!credential) {
    return { ok: false, model, why: `no credential is configured for ${parsed.provider}` };
  }

  return { ok: true, model };
}

/**
 * Overrides the role's model for the run and puts it back afterwards.
 *
 * The role is read from the database by design, so there is no way to pass a model down without
 * giving the pipeline a second, test-only path through it — and that path would then be the thing
 * under test rather than the one the instance uses.
 */
export async function withModel<T>(
  db: Database,
  role: 'prefilter' | 'reviewer',
  model: string | undefined,
  secretKey: string,
  body: () => Promise<T>,
): Promise<T> {
  if (!model) return body();

  const before = (await readSettings(db)).ai.roles[role];
  await writeSettings(db, { ai: { roles: { [role]: model } } }, secretKey);
  try {
    return await body();
  } finally {
    await writeSettings(db, { ai: { roles: { [role]: before } } }, secretKey);
  }
}

/** Sleeps between calls, so a free tier's per-minute limit is not read as a bad answer. */
export async function paced(index: number, spacingMs: number): Promise<void> {
  if (index > 0) await new Promise((resolve) => setTimeout(resolve, spacingMs));
}

/**
 * Writes the run to `$GITHUB_STEP_SUMMARY`, and does nothing anywhere else — a local run has the
 * same numbers on its console already, and a second copy in Markdown would only be noise.
 *
 * Appended rather than written, because each role is its own job step and the summary is one
 * page: the pre-filter and the reviewer should leave two tables under one heading rather than
 * overwriting each other.
 */
export function reportSummary(runs: readonly EvalRun[]): void {
  const markdown = markdownSummary(runs);
  const target = process.env.GITHUB_STEP_SUMMARY;

  if (!target) return;

  try {
    appendFileSync(target, markdown);
  } catch (error) {
    // A summary that cannot be written must not fail a run that otherwise passed.
    console.error(
      `could not write the job summary: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The one-line notice GitHub renders as an annotation, so a skip is visible in the run's log. */
export function notice(message: string): void {
  console.log(process.env.GITHUB_ACTIONS ? `::notice::${message}` : message);
}
