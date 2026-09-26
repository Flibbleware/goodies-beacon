import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readinessGaps } from './readiness.js';
import { wantedSpecSchema } from './spec.js';

const example = (name: string) =>
  wantedSpecSchema.parse(
    JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')),
  );

describe('readinessGaps', () => {
  it('finds nothing missing in either worked example', () => {
    expect(readinessGaps(example('carmageddon'))).toEqual([]);
    expect(readinessGaps(example('power-mac-5500'))).toEqual([]);
  });

  it('asks for a criterion and a search plan in a spec that has neither', () => {
    const spec = { ...example('carmageddon'), criteria: [], searchPlans: [] };

    expect(readinessGaps(spec).map((gap) => gap.section)).toEqual(['criteria', 'searchPlans']);
  });

  it('counts only enabled plans', () => {
    const spec = example('carmageddon');
    const paused = {
      ...spec,
      searchPlans: spec.searchPlans.map((plan) => ({ ...plan, enabled: false })),
    };

    expect(readinessGaps(paused)).toEqual([
      expect.objectContaining({
        section: 'searchPlans',
        message: expect.stringMatching(/^Enable/),
      }),
    ]);
  });

  it('counts only plans on a marketplace the settings switch on', () => {
    const spec = example('carmageddon');
    const switchedOff = { ...spec, settings: { ...spec.settings, sources: [] } };

    expect(readinessGaps(switchedOff)).toEqual([
      expect.objectContaining({
        section: 'searchPlans',
        message: expect.stringMatching(/switched off/),
      }),
    ]);
  });

  it('asks for nothing else: reference images and settings are optional', () => {
    const spec = { ...example('carmageddon'), referenceImages: [] };

    expect(readinessGaps(spec)).toEqual([]);
  });
});
