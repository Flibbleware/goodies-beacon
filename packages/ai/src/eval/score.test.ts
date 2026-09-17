import { describe, expect, it } from 'vitest';
import {
  assertBudget,
  BudgetSpentError,
  type EvalRun,
  markdownSummary,
  score,
  summaryIsEnglish,
  tally,
} from './score.js';

const run = (overrides: Partial<EvalRun> = {}): EvalRun => ({
  role: 'prefilter',
  model: 'openai:gpt-5-nano',
  score: score(tally([{ expected: true, actual: true }])),
  couldNotRun: 0,
  spentUsd: 0.0012,
  failures: [],
  fatal: [],
  ...overrides,
});

describe('tally', () => {
  it('puts each outcome in the quadrant it belongs to', () => {
    const confusion = tally([
      { expected: true, actual: true },
      { expected: true, actual: false },
      { expected: false, actual: true },
      { expected: false, actual: false },
    ]);

    expect(confusion).toEqual({
      truePositives: 1,
      falseNegatives: 1,
      falsePositives: 1,
      trueNegatives: 1,
    });
  });

  it('counts nothing when there is nothing', () => {
    expect(tally([])).toEqual({
      truePositives: 0,
      falsePositives: 0,
      trueNegatives: 0,
      falseNegatives: 0,
    });
  });
});

describe('score', () => {
  it('is perfect when nothing was misclassified', () => {
    const result = score(
      tally([
        { expected: true, actual: true },
        { expected: false, actual: false },
      ]),
    );

    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.total).toBe(2);
  });

  it('separates the two ways of being wrong', () => {
    const result = score(
      tally([
        { expected: true, actual: true },
        { expected: true, actual: false },
        { expected: false, actual: true },
      ]),
    );

    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(0.5);
  });

  /**
   * The case that would otherwise turn a broken fixture set green. A run with no positive cases
   * has not achieved perfect recall — it has measured nothing — and 1.0 would say the opposite.
   */
  it('is null rather than perfect when there was nothing to divide by', () => {
    const noPositives = score(tally([{ expected: false, actual: false }]));
    expect(noPositives.recall).toBeNull();
    expect(noPositives.precision).toBeNull();

    const nothingPredicted = score(tally([{ expected: true, actual: false }]));
    expect(nothingPredicted.precision).toBeNull();
    expect(nothingPredicted.recall).toBe(0);
  });
});

describe('markdownSummary', () => {
  it('puts one row per run in a table, with what it cost', () => {
    const summary = markdownSummary([
      run(),
      run({ role: 'reviewer', model: 'google:gemini-3.8-flash', spentUsd: 0.0208 }),
    ]);

    expect(summary).toContain('| prefilter | `openai:gpt-5-nano` | 100.0% | 100.0% |');
    expect(summary).toContain('| reviewer | `google:gemini-3.8-flash` |');
    expect(summary).toContain('Total spent: **$0.0220**');
    expect(summary).toContain('Every run passed.');
  });

  it('writes a dash where there was nothing to measure, not a hundred per cent', () => {
    const summary = markdownSummary([run({ score: score(tally([])) })]);

    expect(summary).toContain('| — | — |');
  });

  /** A tolerated mistake is listed; only a fatal one stops the run being reported as a pass. */
  it('lists the failures and marks the fatal ones', () => {
    const summary = markdownSummary([
      run({
        failures: ['kept a t-shirt'],
        fatal: ['discarded carmageddon-big-box'],
      }),
    ]);

    expect(summary).toContain('- **discarded carmageddon-big-box**');
    expect(summary).toContain('- kept a t-shirt');
    expect(summary).not.toContain('Every run passed.');
  });
});

describe('assertBudget', () => {
  it('allows a run with no budget at all', () => {
    expect(() => assertBudget(100, null)).not.toThrow();
  });

  it('allows spending up to the budget', () => {
    expect(() => assertBudget(0.49, 0.5)).not.toThrow();
  });

  /**
   * Checked before a call rather than after it: the point is to stop, not to notice afterwards
   * that a loop went wrong.
   */
  it('stops once the budget is reached, and says what was not run', () => {
    expect(() => assertBudget(0.5, 0.5)).toThrow(BudgetSpentError);
    expect(() => assertBudget(0.5, 0.5)).toThrow('the remaining cases were not run');
  });
});

describe('summaryIsEnglish', () => {
  it('accepts a summary with nothing but English in it', () => {
    const result = summaryIsEnglish('Apple Macintosh Performa 5430, sold as untested.');

    expect(result.english).toBe(true);
    expect(result.found).toEqual([]);
    expect(result.share).toBe(0);
  });

  /**
   * The case that made the gate a coin toss. A summary that is English apart from the seller's
   * own word for the condition is doing its job — arguably better than one that paraphrases the
   * quote away — and failing it taught nobody anything.
   */
  it('accepts an English summary that quotes the original', () => {
    const result = summaryIsEnglish(
      'Apple Macintosh Performa 5430 all-in-one, listed as junk or untested ("ジャンク"), ' +
        'with the seller saying the screen shows no burn-in and nothing about the case.',
    );

    expect(result.english).toBe(true);
    expect(result.found).toEqual(['ジ', 'ャ', 'ン', 'ク']);
  });

  /** The failure the case exists for: not translated at all. */
  it('rejects a summary that was never translated', () => {
    const result = summaryIsEnglish(
      'アップル マッキントッシュ パフォーマ 5430 オールインワン、ジャンク品として出品されています。',
    );

    expect(result.english).toBe(false);
    expect(result.share).toBeGreaterThan(0.5);
  });

  it('rejects a summary that is half untranslated', () => {
    const half = `${'x'.repeat(20)}${'ジャンク品として出品'.repeat(2)}`;

    expect(summaryIsEnglish(half).english).toBe(false);
  });

  it('treats an empty summary as English rather than dividing by zero', () => {
    expect(summaryIsEnglish('')).toEqual({ english: true, found: [], share: 0 });
  });
});
