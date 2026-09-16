import { describe, expect, it } from 'vitest';
import { type NotifyInput, notificationMessage } from './notify.js';

/**
 * The email is the product's actual output, and §10 is specific about one thing: an uncertain
 * email says exactly what was unknown. These check the body carries what a person needs to decide
 * whether to click, without opening the app.
 */

const base: NotifyInput = {
  candidateId: 'cand-1',
  itemTitle: 'Carmageddon big box',
  decision: 'match',
  listingTitle: 'Carmageddon PC CD-ROM big box',
  priceGbp: '95.00',
  listingUrl: 'https://marketplace.example.invalid/item/1',
  candidateUrl: 'https://beacon.example.invalid/candidates/cand-1',
  englishSummary: 'A complete big box copy in good condition.',
  criteria: [
    { id: 'big-box', text: 'Big box release, not the jewel case' },
    { id: 'contents', text: 'Box, manual and disc are all present' },
  ],
  criteriaResults: [
    { criterionId: 'big-box', result: 'pass', evidence: 'the box is pictured' },
    { criterionId: 'contents', result: 'pass', evidence: 'all three are shown' },
  ],
};

describe('notificationMessage', () => {
  it('carries the title, the price and both links', () => {
    const message = notificationMessage(base);

    expect(message.subject).toBe('Match: Carmageddon PC CD-ROM big box');
    expect(message.text).toContain('Carmageddon PC CD-ROM big box');
    expect(message.text).toContain('£95.00');
    expect(message.text).toContain(base.listingUrl);
    expect(message.text).toContain(base.candidateUrl);
    expect(message.text).toContain('A complete big box copy');
  });

  it('says so rather than showing a blank when the price is missing', () => {
    expect(notificationMessage({ ...base, priceGbp: null }).text).toContain('Price not given');
  });

  it('lists nothing extra when everything passed', () => {
    const message = notificationMessage(base);

    expect(message.text).not.toContain('Could not be established');
    expect(message.text).not.toContain('Did not pass');
  });

  /**
   * §10: "uncertain emails say exactly what was unknown (manuals not shown or mentioned)". The
   * whole value of an uncertain verdict is that the gap is named, so this is the load-bearing bit.
   */
  it('names each unknown, in the criterion’s own words and with its evidence', () => {
    const message = notificationMessage({
      ...base,
      decision: 'uncertain',
      criteriaResults: [
        { criterionId: 'big-box', result: 'pass', evidence: 'the box is pictured' },
        { criterionId: 'contents', result: 'unknown', evidence: 'manuals not shown or mentioned' },
      ],
    });

    expect(message.subject).toBe('Possible match: Carmageddon PC CD-ROM big box');
    expect(message.text).toContain('Could not be established');
    expect(message.text).toContain('Box, manual and disc are all present');
    expect(message.text).toContain('manuals not shown or mentioned');
  });

  it('lists failures separately from unknowns', () => {
    const message = notificationMessage({
      ...base,
      decision: 'uncertain',
      criteriaResults: [
        { criterionId: 'big-box', result: 'fail', evidence: 'this is a jewel case' },
        { criterionId: 'contents', result: 'unknown', evidence: 'contents not shown' },
      ],
    });

    const failuresAt = message.text.indexOf('Did not pass');
    const unknownsAt = message.text.indexOf('Could not be established');

    expect(failuresAt).toBeGreaterThan(-1);
    expect(unknownsAt).toBeGreaterThan(-1);
    expect(message.text).toContain('this is a jewel case');
  });

  /** A criterion renamed between spec versions must not leave a bare id in an email. */
  it('falls back to the id when the criterion is not in the spec it was given', () => {
    const message = notificationMessage({
      ...base,
      decision: 'uncertain',
      criteria: [],
      criteriaResults: [{ criterionId: 'orphan', result: 'unknown', evidence: 'not shown' }],
    });

    expect(message.text).toContain('orphan');
  });
});
