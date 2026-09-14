import { describe, expect, it } from 'vitest';
import { computeCost, findPrice, PRICES, PRICES_CHECKED_ON } from './pricing.js';

describe('the price table', () => {
  it('records when it was last checked, so staleness is visible rather than silent', () => {
    expect(PRICES_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(PRICES_CHECKED_ON))).toBe(false);
  });

  it('carries the models the default roles are set to', () => {
    expect(findPrice('anthropic', 'claude-opus-5')).toBeDefined();
    expect(findPrice('openai', 'gpt-5-nano')).toBeDefined();
    expect(findPrice('openai', 'gpt-5-mini')).toBeDefined();
  });

  it('prices every entry above zero, in both directions', () => {
    for (const [provider, models] of Object.entries(PRICES)) {
      for (const [model, price] of Object.entries(models)) {
        expect(price.inputPerMillion, `${provider}:${model} input`).toBeGreaterThan(0);
        expect(price.outputPerMillion, `${provider}:${model} output`).toBeGreaterThan(0);
        // Output is dearer than input on every model any provider currently sells; an entry that
        // breaks this is far more likely to be a transposed pair than a new pricing model.
        expect(price.outputPerMillion, `${provider}:${model}`).toBeGreaterThanOrEqual(
          price.inputPerMillion,
        );
      }
    }
  });
});

describe('computeCost', () => {
  it('charges input and output at their own rates', () => {
    // gpt-5-mini: $0.25 in, $2.00 out per million.
    const { costUsd, known } = computeCost('openai', 'gpt-5-mini', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(known).toBe(true);
    expect(costUsd).toBeCloseTo(2.25, 6);
  });

  it('charges a realistic review in fractions of a penny', () => {
    const { costUsd } = computeCost('openai', 'gpt-5-mini', {
      inputTokens: 4_000,
      outputTokens: 400,
    });

    expect(costUsd).toBeGreaterThan(0);
    expect(costUsd).toBeLessThan(0.01);
  });

  /** §9 orders the prompt so the spec and reference images cache; the saving has to be real. */
  it('charges a cache read at a fraction of a fresh read', () => {
    const fresh = computeCost('anthropic', 'claude-opus-5', {
      inputTokens: 10_000,
      outputTokens: 0,
    });
    const cached = computeCost('anthropic', 'claude-opus-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 10_000,
    });

    expect(cached.costUsd).toBeLessThan(fresh.costUsd);
    expect(cached.costUsd).toBeCloseTo(fresh.costUsd * 0.1, 6);
  });

  it('charges a cache write at more than a fresh read, because writing one costs extra', () => {
    const fresh = computeCost('anthropic', 'claude-opus-5', {
      inputTokens: 10_000,
      outputTokens: 0,
    });
    const written = computeCost('anthropic', 'claude-opus-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 10_000,
    });

    expect(written.costUsd).toBeGreaterThan(fresh.costUsd);
  });

  /**
   * The done-when line: an unknown model must not read as free. Zero with `known: false` is a
   * different claim from zero with `known: true`, and the ledger records which.
   */
  it('reports an unknown model as unknown rather than as free', () => {
    const result = computeCost('openai', 'gpt-9-imaginary', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(result).toEqual({ costUsd: 0, known: false });
  });

  it('treats a local model as genuinely free rather than unknown', () => {
    const result = computeCost('ollama', 'llama3.1:8b', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(result).toEqual({ costUsd: 0, known: true });
  });

  /** OpenRouter reprices per underlying model, so there is nothing honest to hard-code. */
  it('reports an OpenRouter call as unknown', () => {
    expect(
      computeCost('openrouter', 'anthropic/claude-opus-5', {
        inputTokens: 1_000,
        outputTokens: 1_000,
      }).known,
    ).toBe(false);
  });

  it('rounds to the six decimals the ledger column stores', () => {
    const { costUsd } = computeCost('openai', 'gpt-5-nano', {
      inputTokens: 1,
      outputTokens: 1,
    });

    expect(costUsd).toBe(Number(costUsd.toFixed(6)));
  });
});
