import { COUNTRY_CODES, type CountryCode, countryName } from '@goodies-beacon/core/schemas';

const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
  a.name.localeCompare(b.name, 'en-GB'),
);

const SHOWN = 8;

/**
 * Countries matching what was typed, best first: the two-letter code exactly, then a name starting
 * with it, then a name with a later word starting with it, then a name containing it anywhere.
 */
export function matchCountries(
  query: string,
  exclude: readonly string[],
): { code: CountryCode; name: string }[] {
  const typed = query.trim().toLowerCase();
  if (typed === '') return [];

  const open = COUNTRIES.filter((country) => !exclude.includes(country.code));
  const byCode = open.filter((country) => country.code.toLowerCase() === typed);
  const byStart = open.filter((country) => country.name.toLowerCase().startsWith(typed));
  const byWord = open.filter((country) =>
    country.name
      .toLowerCase()
      .split(/[\s&()-]+/)
      .some((word) => word.startsWith(typed)),
  );
  const within = open.filter((country) => country.name.toLowerCase().includes(typed));

  return [...new Set([...byCode, ...byStart, ...byWord, ...within])].slice(0, SHOWN);
}
