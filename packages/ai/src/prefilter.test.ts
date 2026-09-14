import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wantedSpecSchema } from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { boundDescription, criteriaTitles, DESCRIPTION_LIMIT } from './prefilter.js';
import { buildPrefilterPrompt, PREFILTER_SYSTEM } from './prompts/prefilter.v1.js';

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));
const SPECS = fileURLToPath(new URL('../../core/src/domain/fixtures', import.meta.url));

function spec(name: string) {
  return wantedSpecSchema.parse(JSON.parse(readFileSync(`${SPECS}/${name}.json`, 'utf8')));
}

const carmageddon = spec('carmageddon');

describe('boundDescription', () => {
  it('leaves a short description alone', () => {
    expect(boundDescription('Big box, complete.')).toBe('Big box, complete.');
  });

  it('reads nothing as nothing, rather than as an empty description', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(boundDescription(empty)).toBeNull();
    }
  });

  /** §7 step 3: the first ~1,500 characters. A seller's essay is not worth paying to read. */
  it('cuts at the limit and says it did', () => {
    const long = `${'word '.repeat(600)}end`;
    const bounded = boundDescription(long);

    expect(bounded).not.toBeNull();
    expect((bounded as string).length).toBeLessThanOrEqual(DESCRIPTION_LIMIT + 1);
    expect(bounded).toMatch(/…$/);
    expect(bounded).not.toContain('end');
  });

  it('cuts at a word boundary rather than through a word', () => {
    const long = `${'alpha bravo '.repeat(200)}`;
    const bounded = boundDescription(long) as string;

    expect(bounded.replace('…', '')).toMatch(/(alpha|bravo)$/);
  });

  /**
   * A description with no spaces — a run of minified HTML, say — must not be cut back to almost
   * nothing by a word boundary that is a thousand characters too early.
   */
  it('keeps the full budget when there is no word boundary near the cut', () => {
    const bounded = boundDescription('x'.repeat(3_000)) as string;

    expect(bounded.length).toBe(DESCRIPTION_LIMIT + 1);
  });

  it('honours a smaller limit when one is given', () => {
    expect((boundDescription('a'.repeat(100), 10) as string).length).toBe(11);
  });
});

describe('criteriaTitles', () => {
  it('takes the text and nothing else, so a cheap text model is not handed the reviewer’s rules', () => {
    const titles = criteriaTitles(carmageddon.criteria);

    expect(titles).toContain('Big box release, not the jewel case or budget re-release');
    expect(titles.join(' ')).not.toContain('hard');
    expect(titles.join(' ')).not.toContain('onUnknown');
  });

  it('drops a criterion with no text rather than sending a blank bullet', () => {
    const titles = criteriaTitles([
      { id: 'a', text: '  ', kind: 'hard', quantifiable: true, onUnknown: 'surface' },
      { id: 'b', text: ' Big box ', kind: 'soft', quantifiable: true, onUnknown: 'surface' },
    ]);

    expect(titles).toEqual(['Big box']);
  });
});

describe('buildPrefilterPrompt', () => {
  const base = {
    specSummary: carmageddon.summary,
    plausibilityNote: carmageddon.plausibilityNote,
    criteriaTitles: criteriaTitles(carmageddon.criteria),
    listingTitle: 'Carmageddon PC CD-ROM big box',
    listingDescription: 'Complete with manual.',
  };

  /**
   * Everything above the listing is identical for every candidate of an item, so a provider that
   * caches prompt prefixes charges a fraction for it from the second listing onwards (§9).
   */
  it('puts the spec first and the listing last', () => {
    const prompt = buildPrefilterPrompt({ ...base, listingTitle: 'A distinctive listing title' });
    const listingAt = prompt.indexOf('# The listing');

    expect(prompt.indexOf('What the collector wants')).toBeLessThan(listingAt);
    expect(prompt.indexOf('How sellers list this')).toBeLessThan(listingAt);
    expect(prompt.indexOf('What the reviewer will check later')).toBeLessThan(listingAt);
    // The title deliberately does not appear in the spec above it — this item's plausibility note
    // quotes example titles, so a realistic one matches twice and proves nothing about order.
    expect(prompt.indexOf('A distinctive listing title')).toBeGreaterThan(listingAt);
    // Nothing follows the listing: it is the last thing the model reads and the first thing that
    // differs between two candidates of the same item.
    expect(prompt.slice(listingAt + '# The listing'.length)).not.toContain('\n# ');
  });

  it('carries the plausibility note, which is the whole point of having one', () => {
    expect(buildPrefilterPrompt(base)).toContain('Sellers title these inconsistently');
  });

  it('leaves the note out entirely when the item has none', () => {
    const prompt = buildPrefilterPrompt({ ...base, plausibilityNote: null });

    expect(prompt).not.toContain('How sellers list this');
    expect(prompt).toContain('What the collector wants');
  });

  /** The reviewer applies the criteria; a cheap text model asked to would reject on photographs. */
  it('labels the criteria as context the pre-filter must not apply', () => {
    const prompt = buildPrefilterPrompt(base);
    const section = prompt.slice(prompt.indexOf('What the reviewer will check later'));

    expect(section).toContain('do not apply these yourself');
  });

  it('omits the criteria section when there are none', () => {
    expect(buildPrefilterPrompt({ ...base, criteriaTitles: [] })).not.toContain(
      'What the reviewer will check later',
    );
  });

  it('says so plainly when a listing has no description', () => {
    const prompt = buildPrefilterPrompt({ ...base, listingDescription: null });

    expect(prompt).toContain('Description: (none given)');
  });

  it('copes with an item whose spec has no summary written yet', () => {
    const prompt = buildPrefilterPrompt({ ...base, specSummary: '' });

    expect(prompt).toContain('(no summary written)');
  });
});

/**
 * The instructions this stage's behaviour rests on. Asserting prose is usually pointless, but
 * these three carry the design: the pre-filter is invisible when it is wrong, so it has to be
 * reluctant to reject, must not judge condition, and must not price-filter. P1-17 measures
 * whether the prompt *works*; this notices if the reasoning is deleted.
 */
describe('the pre-filter prompt', () => {
  it('tells the model that uncertain means plausible', () => {
    expect(PREFILTER_SYSTEM).toMatch(/uncertain is plausible/i);
  });

  it('tells the model that missing information is not evidence against', () => {
    expect(PREFILTER_SYSTEM).toMatch(/missing information is not evidence against/i);
  });

  it('tells the model to leave condition and price alone', () => {
    expect(PREFILTER_SYSTEM).toMatch(/not its condition or completeness/i);
    expect(PREFILTER_SYSTEM).toMatch(/price, postage, location or seller/i);
  });
});

/**
 * The fixture set is what P1-17 turns into a CI gate and what `prefilter-check` runs against a
 * real model. Offline, what can be proved is that it is well formed and that every case reaches
 * the prompt — a case naming a spec that does not exist would otherwise fail only when someone
 * spent money on it.
 */
describe('the pre-filter fixtures', () => {
  const { cases } = JSON.parse(readFileSync(`${FIXTURES}/prefilter-cases.json`, 'utf8')) as {
    cases: {
      id: string;
      spec: string;
      expect: 'plausible' | 'reject';
      why: string;
      title: string;
      description: string;
    }[];
  };

  it('covers both example specs, in both directions', () => {
    for (const name of ['carmageddon', 'power-mac-5500']) {
      const forSpec = cases.filter((entry) => entry.spec === name);
      expect(forSpec.filter((entry) => entry.expect === 'plausible').length).toBeGreaterThan(2);
      expect(forSpec.filter((entry) => entry.expect === 'reject').length).toBeGreaterThan(2);
    }
  });

  it('gives every case a unique id, a title and a reason for existing', () => {
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    for (const entry of cases) {
      expect(entry.title.trim(), entry.id).not.toBe('');
      expect(entry.why.trim(), entry.id).not.toBe('');
    }
  });

  it('builds a prompt for every case against the spec it names', () => {
    for (const entry of cases) {
      const wanted = spec(entry.spec);
      const prompt = buildPrefilterPrompt({
        specSummary: wanted.summary,
        plausibilityNote: wanted.plausibilityNote,
        criteriaTitles: criteriaTitles(wanted.criteria),
        listingTitle: entry.title,
        listingDescription: boundDescription(entry.description),
      });

      expect(prompt, entry.id).toContain(entry.title);
      expect(prompt, entry.id).toContain(wanted.summary);
    }
  });
});
