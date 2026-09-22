import { describe, expect, it } from 'vitest';
import {
  parseSpecText,
  STARTING_SPEC,
  withDocument,
  withReferenceImage,
  withSetting,
} from './parse.js';

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

  /**
   * Every value a field passes through while being typed must leave the form drawable, or the
   * form unmounts under the caret. `P` and `PT` are the first two keystrokes of `PT8H`.
   */
  it.each([
    ['pollEvery', 'P', 'settings.pollEvery'],
    ['pollEvery', 'PT', 'settings.pollEvery'],
    ['gradingScaleId', 'a', 'settings.gradingScaleId'],
    ['priceCeiling', { amount: 0, currency: 'GBP' }, 'settings.priceCeiling.amount'],
    ['listingTypes', [], 'settings.listingTypes'],
    ['negativeKeywords', [''], 'settings.negativeKeywords.0'],
  ])('keeps a draft to draw when %s is %j, and still refuses to save it', (key, value, path) => {
    const result = parseSpecText(JSON.stringify({ settings: { [key]: value } }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.draft).toBeDefined();
      expect(result.issues.map((issue) => issue.path)).toContain(path);
    }
  });

  it('keeps a draft to draw while a criterion or a plan is momentarily empty', () => {
    const result = parseSpecText(
      JSON.stringify({
        settings: {},
        criteria: [{ id: 'a', text: '', kind: 'soft', quantifiable: false }],
        searchPlans: [{ id: 'p', source: 'ebay', query: '', region: '' }],
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.draft?.criteria[0]?.text).toBe('');
  });

  it('gives no draft for a document of the wrong shape', () => {
    const result = parseSpecText(JSON.stringify({ settings: { pollEvery: 8 } }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.draft).toBeUndefined();
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

describe('withDocument', () => {
  it('applies the edit and gives back formatted text', () => {
    const updated = withDocument('{"summary":"old"}', (document) => {
      document.summary = 'new';
    });

    expect(updated).toBe('{\n  "summary": "new"\n}\n');
  });

  it("leaves the caller's text alone when the edit throws nothing at it", () => {
    const text = JSON.stringify({ criteria: [{ id: 'a' }] });

    const updated = withDocument(text, (document) => {
      const [first] = document.criteria as { id: string }[];
      if (first) first.id = 'b';
    });

    expect(JSON.parse(text).criteria[0].id).toBe('a');
    expect(JSON.parse(updated as string).criteria[0].id).toBe('b');
  });

  it('keeps fields the form never touches exactly as they were', () => {
    const text = JSON.stringify({
      searchPlans: [{ id: 'p', watermark: '2026-09-01T00:00:00.000Z' }],
      createdBy: 'manual_edit',
    });

    const updated = withDocument(text, (document) => {
      document.summary = 'added';
    });

    expect(JSON.parse(updated as string)).toEqual({
      searchPlans: [{ id: 'p', watermark: '2026-09-01T00:00:00.000Z' }],
      createdBy: 'manual_edit',
      summary: 'added',
    });
  });

  it('refuses anything that is not a JSON object', () => {
    expect(withDocument('{ not json', () => {})).toBeUndefined();
    expect(withDocument('[]', () => {})).toBeUndefined();
    expect(withDocument('null', () => {})).toBeUndefined();
  });
});

describe('withSetting', () => {
  it('writes inside settings rather than beside it', () => {
    const updated = withSetting('{"settings":{"relists":"show"}}', 'relists', 'suppress');

    expect(JSON.parse(updated as string)).toEqual({ settings: { relists: 'suppress' } });
  });

  it('creates settings when the document has none', () => {
    const updated = withSetting('{"summary":"x"}', 'relists', 'suppress');

    expect(JSON.parse(updated as string).settings).toEqual({ relists: 'suppress' });
  });

  it('replaces a settings that is not an object, rather than writing into it', () => {
    const updated = withSetting('{"settings":3}', 'relists', 'show');

    expect(JSON.parse(updated as string).settings).toEqual({ relists: 'show' });
  });
});
