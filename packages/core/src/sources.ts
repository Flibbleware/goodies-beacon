/**
 * Marketplaces Goodies Beacon knows about. Adapters live in packages/sources/<id>.
 *
 * Two lists, because the id of a source is asked two different questions. "Is this a marketplace
 * a user can poll?" governs queue names, the `WORKER_SOURCES` variable and the Settings page.
 * "Is this a value the database will accept in a source column?" governs the check constraints
 * and the listing schemas — and that one has to include the template adapter, because P1-03's
 * harness and P1-07's ingestion tests run it end to end and store what it produces.
 *
 * Keeping them apart is what stops a `poll._template` queue existing, or the template appearing
 * in the Settings list, while still letting an integration test write a row.
 */

export const MARKETPLACE_SOURCE_IDS = [
  'ebay',
  'vinted',
  'yahoo_auctions_jp',
  'mercari_jp',
] as const;
export type MarketplaceSourceId = (typeof MARKETPLACE_SOURCE_IDS)[number];

/** The example adapter in `packages/sources/_template`. Never polled, never shown, but storable. */
export const TEMPLATE_SOURCE_ID = '_template' as const;

/** Every value a `source` column may hold. */
export const SOURCE_IDS = [...MARKETPLACE_SOURCE_IDS, TEMPLATE_SOURCE_ID] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

/** True only for a real marketplace, so an operator cannot set `WORKER_SOURCES=_template`. */
export function isMarketplaceSourceId(value: string): value is MarketplaceSourceId {
  return (MARKETPLACE_SOURCE_IDS as readonly string[]).includes(value);
}
