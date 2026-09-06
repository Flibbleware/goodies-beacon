import { describe, expect, it } from 'vitest';
import { isSourceId, SOURCE_IDS } from './index.js';

describe('isSourceId', () => {
  it('accepts every known source', () => {
    for (const id of SOURCE_IDS) expect(isSourceId(id)).toBe(true);
  });
  it('rejects unknown sources', () => {
    expect(isSourceId('facebook')).toBe(false);
  });
});
