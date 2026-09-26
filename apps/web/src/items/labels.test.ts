import { describe, expect, it } from 'vitest';
import { criterionName } from './labels.js';

describe('criterionName', () => {
  it('names a shared criterion by its identifier', () => {
    expect(
      criterionName({
        id: 'original-release',
        text: 'The original release',
        shared: 'original-release',
      }),
    ).toBe('original-release');
  });

  it('names one of the item own by its text, quoted', () => {
    expect(criterionName({ id: 'criterion-1a2b3c4d', text: ' Boxed ' })).toBe('“Boxed”');
  });

  it('shortens a long text, and falls back to the id when there is none', () => {
    const name = criterionName({ id: 'long', text: 'word '.repeat(30) });
    expect(name.length).toBeLessThanOrEqual(62);
    expect(name.endsWith('…”')).toBe(true);
    expect(criterionName({ id: 'criterion-1a2b3c4d', text: '  ' })).toBe('criterion-1a2b3c4d');
  });
});
