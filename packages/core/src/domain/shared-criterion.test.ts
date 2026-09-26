import { describe, expect, it } from 'vitest';
import {
  linkedCriterion,
  lockedFields,
  matchesSharedCriterion,
  type SharedCriterionFields,
  sharedCriterionCreateSchema,
  sharedCriterionKeySchema,
  sharedCriterionUpdateSchema,
} from './shared-criterion.js';
import { criterionSchema } from './spec.js';

const classics: SharedCriterionFields = {
  key: 'original-release-not-classics',
  text: 'The original Game Boy release, not the Nintendo Classics re-release',
  kind: 'hard',
  quantifiable: true,
  onUnknown: null,
};

describe('a shared criterion identifier', () => {
  it.each(['original-release-not-classics', 'boxed', 'pal-1995'])('accepts %s', (key) => {
    expect(sharedCriterionKeySchema.parse(key)).toBe(key);
  });

  it.each([
    ['', 'empty'],
    ['Original-Release', 'capitals'],
    ['original release', 'a space'],
    ['-boxed', 'a leading hyphen'],
    ['boxed-', 'a trailing hyphen'],
    ['double--hyphen', 'a doubled hyphen'],
    ['a'.repeat(61), 'sixty-one characters'],
  ])('refuses %j (%s)', (key) => {
    expect(sharedCriterionKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('the save schemas', () => {
  it('leaves the kind, quantifiable and on-unknown open unless given, and tidies the tags', () => {
    const parsed = sharedCriterionCreateSchema.parse({
      key: 'boxed',
      text: '  Comes in its box  ',
      tags: ['Game Boy', ' game boy ', 'boxed'],
    });

    expect(parsed).toEqual({
      key: 'boxed',
      text: 'Comes in its box',
      kind: null,
      quantifiable: null,
      onUnknown: null,
      tags: ['Game Boy', 'boxed'],
    });
  });

  it('refuses an update that tries to change the identifier', () => {
    const result = sharedCriterionUpdateSchema.safeParse({ key: 'renamed', text: 'Boxed' });
    expect(result.success).toBe(false);
  });
});

describe('lockedFields', () => {
  it('fixes the id, the link and the text, and only the flags the shared criterion sets', () => {
    expect(lockedFields(classics)).toEqual({
      id: 'original-release-not-classics',
      shared: 'original-release-not-classics',
      text: classics.text,
      kind: 'hard',
      quantifiable: true,
    });
  });
});

describe('linkedCriterion', () => {
  it('starts what the shared criterion leaves open where a new criterion of its own starts', () => {
    const open: SharedCriterionFields = {
      ...classics,
      kind: null,
      quantifiable: null,
      onUnknown: null,
    };

    expect(linkedCriterion(open, 'reject')).toEqual({
      id: open.key,
      shared: open.key,
      text: open.text,
      kind: 'soft',
      quantifiable: false,
      onUnknown: 'reject',
    });
  });

  it('takes what the shared criterion sets over those defaults, and is a valid criterion', () => {
    const criterion = linkedCriterion(classics, 'surface');

    expect(criterion).toMatchObject({ kind: 'hard', quantifiable: true, onUnknown: 'surface' });
    expect(criterionSchema.parse(criterion)).toEqual(criterion);
  });
});

describe('matchesSharedCriterion', () => {
  const boxed = { key: 'game-boy-boxed', tags: ['Nintendo', 'handheld'] };

  it.each([
    ['', true],
    ['boxed', true],
    ['Game Boy', true],
    ['nintendo', true],
    ['HAND', true],
    ['sega', false],
  ])('%j matches: %s', (query, expected) => {
    expect(matchesSharedCriterion(boxed, query)).toBe(expected);
  });
});
