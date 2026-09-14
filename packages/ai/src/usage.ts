import type { LanguageModelUsage } from 'ai';
import type { Usage } from './pricing.js';

/**
 * The SDK's usage, split the way the price table charges it.
 *
 * `usage.inputTokens` is the **total** input including everything served from or written to the
 * cache, while the price table charges fresh input, cache reads and cache writes at three
 * different rates. Recording the total as `inputTokens` and the cache figures beside it would
 * bill the same tokens twice — a cached review would look several times more expensive than it
 * was and the budget cap would fire early. So the fresh count is what is stored.
 *
 * `noCacheTokens` is preferred where the provider reports it and derived otherwise, because not
 * every provider fills in the detail block.
 */
export function splitUsage(usage: LanguageModelUsage): Usage {
  const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const total = usage.inputTokens ?? 0;

  const noCache =
    usage.inputTokenDetails?.noCacheTokens ??
    // Never negative: a provider that reports cache tokens outside the total would otherwise
    // produce a negative charge, which would quietly credit the month's spend.
    Math.max(0, total - cacheReadTokens - cacheWriteTokens);

  return {
    inputTokens: noCache,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
  };
}
