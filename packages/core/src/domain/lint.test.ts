import { describe, expect, it } from 'vitest';
import { lintCriterion, lintSpec } from './lint.js';
import type { Criterion } from './spec.js';

const criterion = (text: string, extra: Partial<Criterion> = {}): Criterion => ({
  id: 'c1',
  text,
  kind: 'soft',
  quantifiable: true,
  onUnknown: 'surface',
  ...extra,
});

describe('a hard, non-quantifiable criterion', () => {
  it('is flagged, because it rejects on a blurry photo as readily as on a real fault', () => {
    const warnings = lintCriterion(
      criterion('Looks like an original pressing', { kind: 'hard', quantifiable: false }),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('hard_non_quantifiable');
    expect(warnings[0]?.criterionId).toBe('c1');
  });

  it('is still legal: it produces a warning, not a parse failure', () => {
    const warnings = lintCriterion(
      criterion('Looks like an original pressing', { kind: 'hard', quantifiable: false }),
    );

    expect(warnings[0]?.message).toContain('soft is usually what is meant');
  });

  it.each([
    ['hard', true],
    ['soft', false],
    ['soft', true],
  ] as const)('leaves %s/quantifiable=%s alone', (kind, quantifiable) => {
    expect(lintCriterion(criterion('Box shows no water damage', { kind, quantifiable }))).toEqual(
      [],
    );
  });
});

describe('lintSpec', () => {
  it('says nothing about a clean spec', () => {
    expect(
      lintSpec({
        criteria: [
          criterion('Big box release, not the jewel case'),
          criterion('Box, manual and disc are all present', { id: 'c2' }),
        ],
      }),
    ).toEqual([]);
  });

  /**
   * A price or a country in a criterion is no longer flagged (ARCHITECTURE.md §4, v1.24): those
   * are typed fields, and the only way to put one here is to hand-type it into the raw JSON
   * editor. This asserts the absence deliberately, so the regexes are not reinstated by reflex.
   */
  it('does not flag a criterion that merely mentions a price or a place', () => {
    expect(
      lintSpec({
        criteria: [
          criterion('The £10 budget re-release, not the collector’s edition'),
          criterion('Japanese manual included', { id: 'c2' }),
        ],
      }),
    ).toEqual([]);
  });

  it('attributes each warning to its criterion, so the editor can point at the line', () => {
    const warnings = lintSpec({
      criteria: [
        criterion('Big box release'),
        criterion('Looks original', { id: 'the-vague-one', kind: 'hard', quantifiable: false }),
      ],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.criterionId).toBe('the-vague-one');
  });
});
