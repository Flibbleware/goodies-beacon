/**
 * @goodies-beacon/core — shared vocabulary for every other package.
 *
 * P0-01 scaffold: only the package identity is exported. Domain schemas arrive in P1-02,
 * configuration in P0-04, database schema in P0-05.
 */
export const PACKAGE = '@goodies-beacon/core' as const;

/** Marketplaces Goodies Beacon knows about. Adapters live in packages/sources/<id>. */
export const SOURCE_IDS = ['ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}
