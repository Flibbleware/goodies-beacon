import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type DecidableCriterion,
  type DecisionInput,
  decideVerdict,
  type GradeRank,
  resolveOnUnknown,
} from './decide.js';
import { wantedSpecSchema } from './spec.js';
import type { CriterionResultEntry } from './verdict.js';

const SPECS = fileURLToPath(new URL('./fixtures', import.meta.url));

function spec(name: string) {
  return wantedSpecSchema.parse(JSON.parse(readFileSync(`${SPECS}/${name}.json`, 'utf8')));
}

const hard: DecidableCriterion = { id: 'h', text: 'A hard criterion', kind: 'hard' };
const soft: DecidableCriterion = { id: 's', text: 'A soft criterion', kind: 'soft' };

function results(...entries: [string, CriterionResultEntry['result']][]): CriterionResultEntry[] {
  return entries.map(([criterionId, result]) => ({ criterionId, result, evidence: 'because' }));
}

function decide(input: Partial<DecisionInput> & Pick<DecisionInput, 'criteria'>) {
  return decideVerdict({
    settings: { defaultOnUnknown: 'surface', minimumGrade: null },
    criteriaResults: [],
    ...input,
  });
}

/**
 * The rule table from §7 step 6, one row per branch. This is the acceptance test for P1-11: every
 * line of §7 appears here, in both the direction that fires it and the direction that does not.
 */
describe('decideVerdict — the rules of §7 step 6', () => {
  const table: {
    name: string;
    criteria: DecidableCriterion[];
    criteriaResults: CriterionResultEntry[];
    defaultOnUnknown?: 'surface' | 'reject';
    expected: 'match' | 'uncertain' | 'reject';
  }[] = [
    {
      name: 'everything passes → match',
      criteria: [hard, soft],
      criteriaResults: results(['h', 'pass'], ['s', 'pass']),
      expected: 'match',
    },
    {
      name: 'a hard criterion fails → reject',
      criteria: [hard, soft],
      criteriaResults: results(['h', 'fail'], ['s', 'pass']),
      expected: 'reject',
    },
    {
      name: 'a soft criterion fails → uncertain',
      criteria: [hard, soft],
      criteriaResults: results(['h', 'pass'], ['s', 'fail']),
      expected: 'uncertain',
    },
    {
      name: 'an unknown set to surface → uncertain',
      criteria: [{ ...soft, onUnknown: 'surface' }],
      criteriaResults: results(['s', 'unknown']),
      expected: 'uncertain',
    },
    {
      name: 'an unknown set to reject → reject',
      criteria: [{ ...soft, onUnknown: 'reject' }],
      criteriaResults: results(['s', 'unknown']),
      expected: 'reject',
    },
    {
      name: 'an unknown on a hard criterion still obeys onUnknown, not the kind',
      criteria: [{ ...hard, onUnknown: 'surface' }],
      criteriaResults: results(['h', 'unknown']),
      expected: 'uncertain',
    },
    {
      name: 'an unknown falls back to the item default when the criterion has no opinion',
      criteria: [soft],
      criteriaResults: results(['s', 'unknown']),
      defaultOnUnknown: 'reject',
      expected: 'reject',
    },
    {
      name: 'no criteria at all → match, there being nothing to fail',
      criteria: [],
      criteriaResults: [],
      expected: 'match',
    },
  ];

  for (const row of table) {
    it(row.name, () => {
      const { decision } = decideVerdict({
        criteria: row.criteria,
        settings: {
          defaultOnUnknown: row.defaultOnUnknown ?? 'surface',
          minimumGrade: null,
        },
        criteriaResults: row.criteriaResults,
      });

      expect(decision).toBe(row.expected);
    });
  }
});

/**
 * §7 lists the rules in reading order, not severity order: rule 2 yields uncertain and rule 4
 * yields reject. Stopping at the first rule that fires would let a soft failure mask a hard one
 * and email the collector a listing the rules meant to reject.
 */
describe('when several rules fire at once', () => {
  it('takes the worst outcome, not the first one', () => {
    const { decision, reasons } = decide({
      criteria: [soft, { ...hard, onUnknown: 'reject' }],
      criteriaResults: results(['s', 'fail'], ['h', 'unknown']),
    });

    expect(decision).toBe('reject');
    expect(reasons).toHaveLength(2);
  });

  it('a hard fail beats a soft fail', () => {
    expect(
      decide({
        criteria: [hard, soft],
        criteriaResults: results(['h', 'fail'], ['s', 'fail']),
      }).decision,
    ).toBe('reject');
  });

  it('lists the reasons in the order §7 applies the rules', () => {
    const { reasons } = decide({
      criteria: [
        { id: 'a', text: 'Hard fail', kind: 'hard' },
        { id: 'b', text: 'Soft fail', kind: 'soft' },
        { id: 'c', text: 'Surfaced unknown', kind: 'soft', onUnknown: 'surface' },
        { id: 'd', text: 'Rejecting unknown', kind: 'soft', onUnknown: 'reject' },
      ],
      criteriaResults: results(['a', 'fail'], ['b', 'fail'], ['c', 'unknown'], ['d', 'unknown']),
    });

    expect(reasons).toEqual([
      'Hard criterion failed: Hard fail',
      'Soft criterion failed: Soft fail',
      'Could not be established: Surfaced unknown',
      'Could not be established, and set to reject when unknown: Rejecting unknown',
    ]);
  });

  it('gives a clean match no reasons at all', () => {
    expect(decide({ criteria: [hard], criteriaResults: results(['h', 'pass']) }).reasons).toEqual(
      [],
    );
  });
});

/**
 * The reviewer is reconciled against the criteria before it gets here (P1-10), so neither of these
 * should arrive from the pipeline. This function is the last line rather than the first, and a
 * missing result must not read as a pass.
 */
describe('results that do not line up with the criteria', () => {
  it('treats a criterion the reviewer did not answer as unknown', () => {
    const { decision, reasons } = decide({ criteria: [soft], criteriaResults: [] });

    expect(decision).toBe('uncertain');
    expect(reasons[0]).toContain('Could not be established');
  });

  it('ignores a result naming a criterion the spec does not have', () => {
    const { decision, reasons } = decide({
      criteria: [hard],
      criteriaResults: results(['h', 'pass'], ['invented', 'fail']),
    });

    expect(decision).toBe('match');
    expect(reasons).toEqual([]);
  });
});

describe('the grade rules', () => {
  const scale: GradeRank[] = [
    { label: 'Poor', rank: 1 },
    { label: 'Good', rank: 2 },
    { label: 'Excellent', rank: 3 },
  ];

  function withGrade(input: {
    minimumGrade: string | null;
    grade?: string | null;
    gradingScale?: GradeRank[] | null;
  }) {
    return decideVerdict({
      criteria: [],
      criteriaResults: [],
      settings: { defaultOnUnknown: 'surface', minimumGrade: input.minimumGrade },
      grade: input.grade ?? null,
      gradingScale: input.gradingScale === undefined ? scale : input.gradingScale,
    });
  }

  it('does not fire at all when the item sets no minimum', () => {
    expect(withGrade({ minimumGrade: null, grade: 'Poor' })).toEqual({
      decision: 'match',
      reasons: [],
    });
  });

  it('rejects a grade below the minimum', () => {
    const { decision, reasons } = withGrade({ minimumGrade: 'Good', grade: 'Poor' });

    expect(decision).toBe('reject');
    expect(reasons[0]).toBe('Grade Poor is below the minimum of Good');
  });

  it('matches a grade at the minimum', () => {
    expect(withGrade({ minimumGrade: 'Good', grade: 'Good' }).decision).toBe('match');
  });

  it('matches a grade above the minimum', () => {
    expect(withGrade({ minimumGrade: 'Good', grade: 'Excellent' }).decision).toBe('match');
  });

  it('surfaces an unknown grade as uncertain', () => {
    const { decision, reasons } = withGrade({ minimumGrade: 'Good', grade: null });

    expect(decision).toBe('uncertain');
    expect(reasons[0]).toContain('could not be established');
  });

  /**
   * A minimum the instance cannot actually check is shown to the collector, never quietly passed.
   * Both of these are configuration faults rather than listing faults, and silently matching would
   * hide a broken scale behind a stream of apparently fine verdicts.
   */
  it('surfaces a grade that is not on the scale rather than passing it', () => {
    const { decision, reasons } = withGrade({ minimumGrade: 'Good', grade: 'Mint' });

    expect(decision).toBe('uncertain');
    expect(reasons[0]).toContain('"Mint" is not on the attached scale');
  });

  it('surfaces a minimum that is not on the scale', () => {
    const { decision, reasons } = withGrade({ minimumGrade: 'Pristine', grade: 'Good' });

    expect(decision).toBe('uncertain');
    expect(reasons[0]).toContain('"Pristine" is not on the attached scale');
  });

  it('surfaces a minimum with no scale attached at all', () => {
    expect(withGrade({ minimumGrade: 'Good', grade: 'Good', gradingScale: null }).decision).toBe(
      'uncertain',
    );
  });
});

describe('resolveOnUnknown', () => {
  it('prefers the criterion’s own setting to the item default', () => {
    expect(
      resolveOnUnknown({ ...soft, onUnknown: 'reject' }, { defaultOnUnknown: 'surface' }),
    ).toBe('reject');
  });

  it('falls back to the item default when the criterion has no opinion', () => {
    for (const absent of [null, undefined]) {
      expect(resolveOnUnknown({ ...soft, onUnknown: absent }, { defaultOnUnknown: 'reject' })).toBe(
        'reject',
      );
    }
  });
});

/**
 * The example specs are the shapes this will actually meet, and both have a criterion with
 * `onUnknown: reject` — the branch most likely to be got wrong, because it turns "I could not
 * tell" into a rejection.
 */
describe('against the example specs', () => {
  it('matches a Carmageddon listing that passes everything', () => {
    const carmageddon = spec('carmageddon');
    const { decision } = decideVerdict({
      criteria: carmageddon.criteria,
      settings: carmageddon.settings,
      criteriaResults: carmageddon.criteria.map((criterion) => ({
        criterionId: criterion.id,
        result: 'pass' as const,
        evidence: 'shown in the photographs',
      })),
    });

    expect(decision).toBe('match');
  });

  /** `first-game` is hard with `onUnknown: reject`: an edition nobody can determine is not emailed. */
  it('rejects a Carmageddon listing whose edition could not be established', () => {
    const carmageddon = spec('carmageddon');
    const { decision, reasons } = decideVerdict({
      criteria: carmageddon.criteria,
      settings: carmageddon.settings,
      criteriaResults: carmageddon.criteria.map((criterion) => ({
        criterionId: criterion.id,
        result: criterion.id === 'first-game' ? ('unknown' as const) : ('pass' as const),
        evidence: 'nothing in the listing says which one it is',
      })),
    });

    expect(decision).toBe('reject');
    expect(reasons.join(' ')).toContain('set to reject when unknown');
  });

  it('surfaces a Power Mac listing whose CRT could not be judged', () => {
    const performa = spec('power-mac-5500');
    const { decision } = decideVerdict({
      criteria: performa.criteria,
      settings: performa.settings,
      criteriaResults: performa.criteria.map((criterion) => ({
        criterionId: criterion.id,
        result: criterion.id === 'crt-condition' ? ('unknown' as const) : ('pass' as const),
        evidence: 'no photograph shows the screen lit',
      })),
    });

    expect(decision).toBe('uncertain');
  });
});
