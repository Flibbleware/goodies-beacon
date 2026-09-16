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

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export class ModelOutputError extends Error {
  override readonly name = 'ModelOutputError';
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
  }
}

/**
 * Runs the call, giving a malformed structured response one more go.
 *
 * Only `NoObjectGeneratedError` is retried here: everything else is either already retried by the
 * SDK or is not going to be helped by asking again. The second attempt is billed like the first,
 * which is why there is exactly one.
 */
async function attempt<R>(call: () => Promise<R>, abortSignal?: AbortSignal): Promise<R> {
  let last: unknown;

  for (let tries = 0; tries <= OBJECT_RETRIES; tries += 1) {
    try {
      return await call();
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

  try {
    const result = await attempt(
      () =>
        generateObject({
          model: role.languageModel,
          schema: request.schema,
          system: request.system,
          ...(typeof prompt === 'string' ? { prompt } : { messages: prompt }),
          maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          maxRetries: TRANSPORT_RETRIES,
          ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
        }),
      request.abortSignal,
    );

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
