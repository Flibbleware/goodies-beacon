/** Marketplaces Goodies Beacon knows about. Adapters live in packages/sources/<id>. */
export const SOURCE_IDS = ['ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}
