import type { AiProvider } from '@goodies-beacon/core';

/**
 * What a model call costs, from a table in the repo (§9).
 *
 * A table rather than a lookup because there is no cross-provider pricing API, and rates move:
 * the date below is what makes staleness visible instead of silent. A model that is not here
 * costs an unknown amount, which is recorded as unknown and warned about — never as zero, which
 * would read as "this was free" on the costs page and let the budget cap run past its limit.
 */

/**
 * When these rates were last checked against each provider's own pricing page.
 *
 * Anthropic's come from the bundled API reference; OpenAI's from
 * developers.openai.com/api/docs/pricing and Google's from ai.google.dev/gemini-api/docs/pricing,
 * both read on this date. Re-check it when a model is added.
 */
export const PRICES_CHECKED_ON = '2026-09-14';

export interface ModelPrice {
  /** US dollars per million tokens. */
  inputPerMillion: number;
  outputPerMillion: number;
  /**
   * Cached input, as a multiple of the input rate.
   *
   * Defaults follow the providers' published ratios — a cache read is roughly a tenth of a fresh
   * read and a write roughly a quarter more — and matter because §9 orders the prompt so that the
   * spec, criteria and reference images cache on every candidate of an item.
   */
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
}

const DEFAULT_CACHE_READ = 0.1;
const DEFAULT_CACHE_WRITE = 1.25;

/**
 * Long-context tiers are deliberately not modelled. Google and OpenAI both charge more above
 * ~200k input tokens, and no role here comes close: a pre-filter is a title and 1,500 characters,
 * and a review is a spec plus a handful of downscaled images. A second rate for a case that
 * cannot arise is a branch nothing would ever test.
 */
export const PRICES: Record<AiProvider, Record<string, ModelPrice>> = {
  anthropic: {
    'claude-fable-5-1': { inputPerMillion: 10, outputPerMillion: 50 },
    'claude-fable-5': { inputPerMillion: 10, outputPerMillion: 50 },
    'claude-opus-5': { inputPerMillion: 5, outputPerMillion: 25 },
    'claude-opus-4-8': { inputPerMillion: 5, outputPerMillion: 25 },
    'claude-opus-4-7': { inputPerMillion: 5, outputPerMillion: 25 },
    'claude-opus-4-6': { inputPerMillion: 5, outputPerMillion: 25 },
    'claude-sonnet-5': { inputPerMillion: 2, outputPerMillion: 10 },
    'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
    'claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },
  },
  openai: {
    'gpt-6-astra': { inputPerMillion: 10, outputPerMillion: 50 },
    'gpt-5.6-sol': { inputPerMillion: 4, outputPerMillion: 20 },
    'gpt-5.6-terra': { inputPerMillion: 2, outputPerMillion: 12 },
    'gpt-5.6-luna': { inputPerMillion: 0.2, outputPerMillion: 1.2 },
    'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10 },
    'gpt-5-mini': { inputPerMillion: 0.25, outputPerMillion: 2 },
    'gpt-5-nano': { inputPerMillion: 0.05, outputPerMillion: 0.4 },
  },
  google: {
    'gemini-3.8-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75 },
    'gemini-3.7-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75 },
    'gemini-3.6-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75 },
    'gemini-3.5-flash': { inputPerMillion: 1.5, outputPerMillion: 9 },
    'gemini-3.5-flash-lite': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    'gemini-3.1-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
    'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    'gemini-2.5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  },
  /**
   * OpenRouter prices per underlying model and changes them without notice, so there is nothing
   * honest to put here. Its calls are recorded with the cost unknown; the spend it reports in its
   * own dashboard is the authority.
   */
  openrouter: {},
  /** A local model costs no money to call. Zero here is a fact, not a missing row. */
  ollama: {},
} as const;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CostResult {
  costUsd: number;
  /** False when the model is not in the table: the cost is a floor, not a figure. */
  known: boolean;
}

export function findPrice(provider: AiProvider, model: string): ModelPrice | undefined {
  return PRICES[provider]?.[model];
}

/**
 * What one call cost, in US dollars.
 *
 * Ollama is free by construction. An unknown model on a paid provider returns zero with
 * `known: false`, so the caller warns once and the costs page can say "at least" rather than
 * presenting a guess as a measurement.
 */
export function computeCost(provider: AiProvider, model: string, usage: Usage): CostResult {
  if (provider === 'ollama') return { costUsd: 0, known: true };

  const price = findPrice(provider, model);
  if (!price) return { costUsd: 0, known: false };

  const perToken = price.inputPerMillion / 1_000_000;
  const cacheRead = perToken * (price.cacheReadMultiplier ?? DEFAULT_CACHE_READ);
  const cacheWrite = perToken * (price.cacheWriteMultiplier ?? DEFAULT_CACHE_WRITE);

  const costUsd =
    usage.inputTokens * perToken +
    usage.outputTokens * (price.outputPerMillion / 1_000_000) +
    (usage.cacheReadTokens ?? 0) * cacheRead +
    (usage.cacheWriteTokens ?? 0) * cacheWrite;

  // Six decimals is what the ledger column stores; rounding here keeps the two in step.
  return { costUsd: Math.round(costUsd * 1_000_000) / 1_000_000, known: true };
}
