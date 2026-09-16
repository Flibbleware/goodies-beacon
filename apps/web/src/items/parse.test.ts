import { describe, expect, it } from 'vitest';
import { parseSpecText, STARTING_SPEC, withReferenceImage } from './parse.js';

const image = {
  id: '7f1f1b7e-6a1e-4a54-9b7c-2f9a1a6c1234',
  path: 'ab/cd/abcd.webp',
  label: 'UK big box, front',
  addedAt: new Date('2026-09-16T10:00:00.000Z'),
};

describe('parseSpecText', () => {
  it('accepts the document a new item starts from', () => {
    const result = parseSpecText(STARTING_SPEC);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it('says so rather than parsing nothing at all', () => {
    const result = parseSpecText('   \n ');

    expect(result).toEqual({ ok: false, issues: [{ path: 'spec', message: 'is empty' }] });
  });

  it('reports a syntax error as one, in the engine’s own words', () => {
    const result = parseSpecText('{ "summary": }');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.path).toBe('JSON');
      expect(result.issues[0]?.message).not.toBe('');
    }
  });

  /** The acceptance line: a spec that fails the schema cannot be saved and the error names where. */
  it('names the path of every field the schema rejects', () => {
    const result = parseSpecText(
      JSON.stringify({
        settings: { priceCeiling: { amount: 120, currency: 'USD' } },
        criteria: [{ id: 'a', text: '', kind: 'hard', quantifiable: true }],
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((issue) => issue.path);
      expect(paths).toContain('settings.priceCeiling.currency');
      expect(paths).toContain('criteria.0.text');
    }
  });

  it('lints a spec that parses, without refusing it', () => {
    const result = parseSpecText(
      JSON.stringify({
        settings: {},
        criteria: [
          { id: 'scratches', text: 'No deep scratches', kind: 'hard', quantifiable: false },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.code).toBe('hard_non_quantifiable');
      expect(result.warnings[0]?.criterionId).toBe('scratches');
    }
  });
});

describe('withReferenceImage', () => {
  it('appends to the array the document already has', () => {
    const text = JSON.stringify({ summary: 'x', referenceImages: [] });

    const updated = withReferenceImage(text, image);

    expect(updated).toBeDefined();
    expect(JSON.parse(updated as string)).toEqual({
      summary: 'x',
      referenceImages: [{ ...image, addedAt: image.addedAt.toISOString() }],
    });
  });

  it('creates the array when the document has none', () => {
    const updated = withReferenceImage('{}', image);

    expect(JSON.parse(updated as string).referenceImages).toHaveLength(1);
  });

  it('leaves a document it cannot understand alone', () => {
    expect(withReferenceImage('{ not json', image)).toBeUndefined();
    expect(withReferenceImage('[]', image)).toBeUndefined();
    expect(withReferenceImage('{ "referenceImages": 3 }', image)).toBeUndefined();
  });
});
