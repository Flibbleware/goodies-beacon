import type { SourceId } from '../sources.js';
import type { SearchPlan } from './spec.js';

export interface Region {
  /** In the source's own vocabulary, exactly as the adapter sends it: `EBAY_GB`. */
  value: string;
  label: string;
}

/** eBay's sites, by the id the Browse API takes in `X-EBAY-C-MARKETPLACE-ID` (§2). */
export const EBAY_MARKETPLACES = [
  { value: 'EBAY_GB', label: 'United Kingdom (ebay.co.uk)' },
  { value: 'EBAY_US', label: 'United States (ebay.com)' },
  { value: 'EBAY_DE', label: 'Germany (ebay.de)' },
  { value: 'EBAY_FR', label: 'France (ebay.fr)' },
  { value: 'EBAY_IT', label: 'Italy (ebay.it)' },
  { value: 'EBAY_ES', label: 'Spain (ebay.es)' },
  { value: 'EBAY_AU', label: 'Australia (ebay.com.au)' },
  { value: 'EBAY_CA', label: 'Canada (ebay.ca)' },
  { value: 'EBAY_IE', label: 'Ireland (ebay.ie)' },
] as const satisfies readonly Region[];

/**
 * The regions each source can search, where the list is known (P1-29). They live here rather than
 * in the adapters because the spec form and the store both need them and neither can import an
 * adapter; each adapter's `describeSearchOptions()` returns its entry. A source with no entry —
 * the three without an adapter until Phase 4, and the template — is not checked.
 */
export const SOURCE_REGIONS: Partial<Record<SourceId, readonly Region[]>> = {
  ebay: EBAY_MARKETPLACES,
};

export interface RegionIssue {
  /** The plan's position in `searchPlans`, so the issue can be placed beside its field. */
  index: number;
  message: string;
}

/**
 * Each search plan whose region its source does not have. An adapter sends the region as it is —
 * eBay's in a header — so a typo or a list (`EBAY_GB, EBAY_US`) otherwise saves without complaint
 * and fails on every poll. Shared by the store, which refuses such a spec, and the spec form, which
 * says so beside the field first.
 */
export function unknownRegions(
  plans: readonly Pick<SearchPlan, 'source' | 'region'>[],
): RegionIssue[] {
  return plans.flatMap(({ source, region }, index) => {
    const regions = SOURCE_REGIONS[source];
    if (!regions || regions.some(({ value }) => value === region)) return [];
    const known = regions.map(({ value }) => value).join(', ');
    return [
      {
        index,
        message: `“${region}” is not a region ${source} can search. A plan searches one of ${known}; add a plan for each.`,
      },
    ];
  });
}
