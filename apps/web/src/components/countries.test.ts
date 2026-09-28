import { describe, expect, it } from 'vitest';
import { matchCountries } from './countries.js';

const names = (query: string, exclude: string[] = []) =>
  matchCountries(query, exclude).map((country) => country.name);

describe('matchCountries', () => {
  it('finds a country by the start of its name, or of any word in it', () => {
    expect(names('jap')).toEqual(['Japan']);
    expect(names('kingdom')).toContain('United Kingdom');
  });

  it('puts a name that starts with it ahead of one where a later word does', () => {
    expect(names('gui').slice(0, 2)).toEqual(['Guinea', 'Guinea-Bissau']);
  });

  it('puts an exact code first', () => {
    expect(names('cn')[0]).toBe('China');
  });

  it('leaves out what is already chosen, and offers nothing for nothing typed', () => {
    expect(names('jap', ['JP'])).toEqual([]);
    expect(names('  ')).toEqual([]);
  });

  it('shows at most eight', () => {
    expect(names('a').length).toBeLessThanOrEqual(8);
  });
});
