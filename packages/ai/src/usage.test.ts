import type { LanguageModelUsage } from 'ai';
import { describe, expect, it } from 'vitest';
import { computeCost } from './pricing.js';
import { splitUsage } from './usage.js';

/** The SDK's shape, with only the fields the split reads. */
function usage(partial: Partial<LanguageModelUsage>): LanguageModelUsage {
  return {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    ...partial,
  } as LanguageModelUsage;
}

describe('splitUsage', () => {
  /**
   * The trap this exists for: `inputTokens` is the *total* including cache, so recording it as
   * the fresh count and the cache figures beside it charges the same tokens twice.
   */
  it('records fresh input only, so cached tokens are not billed twice', () => {
    const split = splitUsage(
      usage({
        inputTokens: 10_000,
        outputTokens: 500,
        inputTokenDetails: {
          noCacheTokens: 2_000,
          cacheReadTokens: 8_000,
          cacheWriteTokens: 0,
        },
      }),
    );

    expect(split.inputTokens).toBe(2_000);
    expect(split.cacheReadTokens).toBe(8_000);
    expect(split.inputTokens + (split.cacheReadTokens ?? 0)).toBe(10_000);
  });

  it('derives the fresh count when a provider reports no detail', () => {
    const split = splitUsage(
      usage({
        inputTokens: 10_000,
        outputTokens: 500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 8_000,
          cacheWriteTokens: 1_000,
        },
      }),
    );

    expect(split.inputTokens).toBe(1_000);
  });

  /** A credit against the month's spend would be worse than an overcharge: it hides itself. */
  it('never derives a negative count, however the provider reports it', () => {
    const split = splitUsage(
      usage({
        inputTokens: 1_000,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 8_000,
          cacheWriteTokens: 0,
        },
      }),
    );

    expect(split.inputTokens).toBe(0);
  });

  it('reads a call that used no cache at all', () => {
    const split = splitUsage(usage({ inputTokens: 900, outputTokens: 120 }));

    expect(split).toEqual({
      inputTokens: 900,
      outputTokens: 120,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('copes with a provider that reported nothing', () => {
    expect(splitUsage(usage({}))).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  /** End to end: the same call priced from the split is cheaper than the naive reading. */
  it('makes a cached review cheaper than counting the total as fresh input', () => {
    const reported = usage({
      inputTokens: 10_000,
      outputTokens: 500,
      inputTokenDetails: { noCacheTokens: 2_000, cacheReadTokens: 8_000, cacheWriteTokens: 0 },
    });

    const correct = computeCost('anthropic', 'claude-opus-5', splitUsage(reported));
    const naive = computeCost('anthropic', 'claude-opus-5', {
      inputTokens: reported.inputTokens ?? 0,
      outputTokens: reported.outputTokens ?? 0,
      cacheReadTokens: reported.inputTokenDetails?.cacheReadTokens ?? 0,
    });

    expect(correct.costUsd).toBeLessThan(naive.costUsd);
  });
});
