import type { WantedSpec } from './spec.js';

/** A part of the spec a poll means nothing without, named by the item page section it lives in. */
export interface ReadinessGap {
  section: 'criteria' | 'searchPlans';
  message: string;
}

/**
 * What a spec still lacks before polling it is worth anything (P1-26). An empty list is ready.
 *
 * Only what a poll cannot do without is asked for. A search plan is what a poll runs, so without
 * one enabled on a marketplace that is switched on nothing is searched at all. A criterion is what
 * the decision rules fail a listing on (§7 step 6), so without one every listing the pre-filter
 * keeps is a match. The settings all have defaults and reference images are optional — the
 * reviewer judges from the criteria alone — so neither is asked for.
 *
 * Each message says what to do and then why, in the owner's terms rather than the pipeline's:
 * they are read beside the section and under Start Polling by someone who has not read §7.
 *
 * Shared by the item page, which marks each gap beside its section, and the store, which refuses
 * to make an item active while any remain, so the marks and the refusal cannot disagree.
 */
export function readinessGaps(
  spec: Pick<WantedSpec, 'criteria' | 'searchPlans' | 'settings'>,
): ReadinessGap[] {
  const gaps: ReadinessGap[] = [];

  if (spec.criteria.length === 0) {
    gaps.push({
      section: 'criteria',
      message:
        'Add a criterion. A listing is only ever rejected for failing one, so without any, nearly everything found would be emailed as a match.',
    });
  }

  const enabled = spec.searchPlans.filter((plan) => plan.enabled);
  if (enabled.length === 0) {
    gaps.push({
      section: 'searchPlans',
      message:
        spec.searchPlans.length === 0
          ? 'Add a search plan. Without one, nothing is searched for.'
          : 'Enable a search plan. They are all paused, so nothing is searched for.',
    });
  } else if (!enabled.some((plan) => spec.settings.sources.includes(plan.source))) {
    gaps.push({
      section: 'searchPlans',
      message:
        'Switch a marketplace on in Settings, or add a plan on one that is on. Every enabled plan is on a marketplace switched off, so nothing is searched for.',
    });
  }

  return gaps;
}
