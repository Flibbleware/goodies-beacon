import {
  type AiKeys,
  type AiRole,
  type Database,
  type Logger,
  readSettings,
  type Settings,
} from '@goodies-beacon/core';
import { generateObject, NoObjectGeneratedError } from 'ai';
import type { z } from 'zod';
import type { PromptPart } from './images.js';
import { type LedgerEntry, recordUsage } from './ledger.js';
import type { Usage } from './pricing.js';
import { createModel, type ResolvedRole } from './providers.js';
import { splitUsage } from './usage.js';

/**
 * The one call the rest of Goodies Beacon makes to a model (§9).
 *
 * Everything the pipeline needs is here and nowhere else: which model a role uses, structured
 * output held to a Zod schema, the retry a malformed response gets, and the ledger row. A caller
 * names a role and a schema; it never names a provider, which is what makes swapping one a
 * Settings change (P1-17 leans on this to run the same eval suite against two providers).
 */

export interface GenerateDeps {
  db: Database;
  logger: Logger;
  secretKey: string;
  /**
   * Provider keys from `.env` (§12 allows either source).
   *
   * Optional, and omitting it is quietly consequential: a provider configured only in `.env` then
   * looks unconfigured, and every call fails the same way a missing key does. Pass `config.ai`
   * unless you mean Settings to be the only source.
   */
  env?: AiKeys;
  /** Read once by the caller when it is making several calls; re-read here otherwise. */
  settings?: Settings;
}

export interface GenerateRequest<T> {
  role: AiRole;
  schema: z.ZodType<T>;
  system: string;
  prompt: string | PromptPart[];
  /** Recorded on the ledger row so the costs page can group by item (§9). */
  wantedItemId?: string | null;
  candidateId?: string | null;
  /** Bounds a runaway generation; a structured verdict is small. */
  maxOutputTokens?: number;
  /** Sampling temperature. Omit to take the provider's default, which is usually 1. */
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface GenerateResult<T> {
  object: T;
  role: ResolvedRole;
  costUsd: number;
  /** False when the model was not in the price table, so the cost is a floor. */
  costKnown: boolean;
  /**
   * The tokens this call used, split the way the price table charges them.
   *
   * Also on the ledger row, and on a verdict too (§4) because the two answer different questions:
   * the ledger is "what has this month cost", the verdict is "what did judging *this* listing
   * cost", and the second must survive the retention that prunes the first.
   */
  usage: Usage;
  /** `provider:model`, as a verdict records the model that judged it (§4). */
  modelRef: string;
  /** The text actually sent, stored with a verdict so "Show prompt" is a read (P1-10). */
  promptText: string;
}

/**
 * A malformed structured response is retried once and then given up on.
 *
 * Once rather than the default several times: the usual cause is a model that cannot hold the
 * schema, and a second failure is evidence of that rather than bad luck. Each attempt is billed,
 * so retrying five times to reach the same conclusion spends five times as much to learn it.
 *
 * **This is our own retry, not the SDK's.** `maxRetries` covers *retryable API errors* — a 429, a
 * 5xx, a dropped connection — and a response that parsed but did not match the schema is not one
 * of them, so the SDK throws `NoObjectGeneratedError` on the first attempt however high it is set.
 * Passing it as `maxRetries` (which is what P1-08 did) therefore bought nothing, and P1-10's
 * "retried once and then recorded as a review failure" was quietly untrue until a test counted
 * the calls.
 */
export const OBJECT_RETRIES = 1;

/** The SDK's own retry, for the failures it *does* consider retryable. */
const TRANSPORT_RETRIES = 1;

/**
 * Only for a caller that names no ceiling of its own. Both roles that exist do — and both had to,
 * because a *reasoning* model is charged for its hidden reasoning against this same allowance, so
 * a number chosen by looking at how long the answer is will be far too small. Whatever asks next
 * should measure before it trusts this (P1-17 found both existing roles the hard way).
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/**
 * What the pre-filter and the reviewer ask for, because both are classifiers rather than writers.
 *
 * Neither had a temperature until P1-17, so both ran at the provider's default of 1 — and a
 * classifier at 1 gives different answers to the same listing on different days. That is not only
 * an evaluation problem: §4 makes the newest verdict authoritative and Phase 5 re-reviews a
 * candidate on demand, so a re-review at full sampling temperature is partly a dice roll rather
 * than a second, better-informed look.
 *
 * It is a request, not a guarantee. A reasoning model refuses it — OpenAI's answer is "temperature
 * is not supported for reasoning models" — and the SDK drops it and warns. Sending it anyway is
 * still right: it is provider-neutral (§9), it takes effect everywhere it can, and the warning is
 * now routed through this package's logger rather than printed past it.
 */
export const CLASSIFIER_TEMPERATURE = 0;

/**
 * The SDK prints its warnings straight to the console, which goes round pino, ignores `LOG_LEVEL`
 * and produces an unstructured line per call in production. They are worth having, so they are
 * turned off here and re-emitted through the logger below instead.
 */
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/** One line per model per warning per process: a poll of 500 listings must not log 500 times. */
const warned = new Set<string>();

function logWarnings(logger: Logger, role: ResolvedRole, warnings: unknown): void {
  if (!Array.isArray(warnings)) return;

  // `feature` in the current provider spec, `setting` in older ones; read whichever is there
  // rather than tying the log line to one version of a field nobody outside the SDK sees.
  for (const warning of warnings as {
    type?: string;
    feature?: string;
    setting?: string;
    details?: string;
  }[]) {
    const subject = warning.feature ?? warning.setting;
    const key = `${role.provider}:${role.model}:${warning.type}:${subject ?? ''}`;
    if (warned.has(key)) continue;
    warned.add(key);

    logger.debug('the provider did not accept part of the request', {
      model: `${role.provider}:${role.model}`,
      type: warning.type ?? 'unknown',
      ...(subject ? { setting: subject } : {}),
      ...(warning.details ? { details: warning.details } : {}),
    });
  }
}

export class ModelOutputError extends Error {
  override readonly name = 'ModelOutputError';
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
  }
}

/**
 * How much more room the second attempt gets than the first.
 *
 * `NoObjectGeneratedError` has two causes and they want opposite treatment. A model that emitted
 * something malformed may do better asked again; a *reasoning* model that spent its whole output
 * allowance thinking and had none left for the answer will fail identically for ever, because the
 * retry was an exact repeat of the call that just failed. That second case is the common one —
 * P1-17 met it three times, at three different ceilings — so the retry is given more room, which
 * costs nothing when the first attempt succeeds and turns a billed, doomed repeat into one that
 * can work.
 */
export const RETRY_HEADROOM = 2;

/**
 * Runs the call, giving a malformed structured response one more go — with more room to answer in.
 *
 * Only `NoObjectGeneratedError` is retried here: everything else is either already retried by the
 * SDK or is not going to be helped by asking again. The second attempt is billed like the first,
 * which is why there is exactly one.
 */
async function attempt<R>(
  call: (attemptNumber: number) => Promise<R>,
  abortSignal?: AbortSignal,
): Promise<R> {
  let last: unknown;

  for (let tries = 0; tries <= OBJECT_RETRIES; tries += 1) {
    try {
      return await call(tries);
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error) || abortSignal?.aborted) throw error;
      last = error;
    }
  }

  throw last;
}

export async function generateForRole<T>(
  deps: GenerateDeps,
  request: GenerateRequest<T>,
): Promise<GenerateResult<T>> {
  const settings = deps.settings ?? (await readSettings(deps.db));
  const role = createModel(settings.ai.roles[request.role], {
    settings,
    secretKey: deps.secretKey,
    ...(deps.env ? { env: deps.env } : {}),
  });

  const prompt =
    typeof request.prompt === 'string'
      ? request.prompt
      : [{ role: 'user' as const, content: [...request.prompt] }];

  const cap = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  try {
    const result = await attempt(
      (tries) =>
        generateObject({
          model: role.languageModel,
          schema: request.schema,
          system: request.system,
          ...(typeof prompt === 'string' ? { prompt } : { messages: prompt }),
          maxOutputTokens: tries === 0 ? cap : cap * RETRY_HEADROOM,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          maxRetries: TRANSPORT_RETRIES,
          ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
        }),
      request.abortSignal,
    );

    logWarnings(deps.logger, role, result.warnings);

    const entry: LedgerEntry = {
      role: request.role,
      provider: role.provider,
      model: role.model,
      usage: splitUsage(result.usage),
      wantedItemId: request.wantedItemId ?? null,
      candidateId: request.candidateId ?? null,
    };
    const { costUsd, known } = await recordUsage(deps.db, deps.logger, entry);

    return {
      object: result.object,
      role,
      costUsd,
      costKnown: known,
      usage: entry.usage,
      modelRef: `${role.provider}:${role.model}`,
      promptText: describePrompt(request),
    };
  } catch (error) {
    /**
     * A model that answered but not to the schema is a different failure from one that could not
     * be reached, and P1-10 records it as a review failure rather than retrying it for ever. The
     * call was still billed, but the SDK does not report usage on a throw, so there is nothing
     * honest to put in the ledger — the provider's own dashboard is the authority for those.
     */
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new ModelOutputError(
        `${role.provider}:${role.model} did not return output matching the schema`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * The prompt as text, for the verdict's "Show prompt" (P1-10).
 *
 * Images are named rather than embedded: a stored prompt carrying half a megabyte of base64 per
 * verdict would dwarf every other row in the database and the nightly dump with it.
 */
function describePrompt<T>(request: GenerateRequest<T>): string {
  const body =
    typeof request.prompt === 'string'
      ? request.prompt
      : request.prompt.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n');

  return `${request.system}\n\n${body}`;
}
