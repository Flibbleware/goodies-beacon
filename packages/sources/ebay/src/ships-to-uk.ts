import type { ShipsToUk } from '@goodies-beacon/core';

/**
 * Derives the ships-to-UK flag from `getItem`'s `shipToLocations` (§4, §10).
 *
 * Only available after enrichment: S1-01 found `shipToLocations` is absent from search results,
 * so a candidate rejected before enrichment never carries the flag, and it can never be a
 * pre-filter input.
 *
 * Three-valued on purpose. The requirement is to *show* whether a listing ships to the UK, not to
 * filter on it, so a shape this code does not recognise must answer `unknown` rather than guess —
 * a wrong `no` hides a listing the owner wanted to see.
 */

export interface ShipRegion {
  regionName?: string;
  regionType?: string;
  regionId?: string;
}

export interface ShipToLocations {
  regionIncluded?: ShipRegion[];
  regionExcluded?: ShipRegion[];
}

const UK_IDS = new Set(['GB', 'UK']);
/** eBay's world regions that contain the UK. `WORLDWIDE` carries no id, only the type. */
const UK_WORLD_REGIONS = new Set(['EUROPE', 'WORLDWIDE']);

function mentionsUk(region: ShipRegion): boolean {
  const id = region.regionId?.toUpperCase() ?? '';
  const type = region.regionType?.toUpperCase() ?? '';
  const name = region.regionName?.toUpperCase() ?? '';

  if (type === 'COUNTRY') return UK_IDS.has(id);
  if (type === 'WORLDWIDE') return true;
  if (type === 'WORLD_REGION') return UK_WORLD_REGIONS.has(id) || UK_WORLD_REGIONS.has(name);
  return false;
}

export function deriveShipsToUk(locations: ShipToLocations | undefined | null): ShipsToUk {
  const included = locations?.regionIncluded ?? [];
  const excluded = locations?.regionExcluded ?? [];

  if (included.length === 0) return 'unknown';

  // Exclusion wins: a seller who ships worldwide except the UK does not ship to the UK. Only a
  // country-level exclusion counts, since excluding a sub-national area such as APO/FPO says
  // nothing about the country as a whole.
  if (
    excluded.some(
      (region) =>
        region.regionType?.toUpperCase() === 'COUNTRY' &&
        UK_IDS.has(region.regionId?.toUpperCase() ?? ''),
    )
  ) {
    return 'no';
  }

  if (included.some(mentionsUk)) return 'yes';

  /**
   * A list that names countries but not the UK is a real "no". A list of shapes this code does
   * not understand is not — it is a gap in this function, and saying `unknown` surfaces the
   * listing rather than hiding it.
   */
  const understood = included.filter(
    (region) => region.regionType?.toUpperCase() === 'COUNTRY' || mentionsUk(region),
  );
  return understood.length > 0 ? 'no' : 'unknown';
}
