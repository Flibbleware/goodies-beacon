import type {
  BackfillDepth,
  BuyingType,
  ConditionCategory,
  MarketplaceSourceId,
  NotificationMode,
  OnUnknown,
  RelistPolicy,
  ShipsToUkPolicy,
} from '@goodies-beacon/core/schemas';

/**
 * The words a setting's stored value is shown in, shared by the settings editor and the item page's
 * settings card so the two never name one value differently (P1-26).
 */

export const SOURCE_LABELS: Record<MarketplaceSourceId, string> = {
  ebay: 'eBay',
  vinted: 'Vinted',
  yahoo_auctions_jp: 'Yahoo! Auctions JP',
  mercari_jp: 'Mercari JP',
};

/** A source's name; one no marketplace owns (the template adapter's) is shown as its id. */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as MarketplaceSourceId] ?? source;
}

/**
 * The marketplaces with an adapter to poll them. The rest are hidden until Phase 4 builds theirs:
 * ticking one today would search nothing. A spec that already names one still shows it.
 */
export const OFFERED_SOURCES: readonly MarketplaceSourceId[] = ['ebay'];

export function isOffered(source: string): boolean {
  return (OFFERED_SOURCES as readonly string[]).includes(source);
}

export const LISTING_TYPE_LABELS: Record<BuyingType, string> = {
  auction: 'Auction',
  fixed: 'Fixed price',
};

export const CONDITION_LABELS: Record<ConditionCategory, string> = {
  any: 'Any condition',
  new: 'New',
  used: 'Used',
  for_parts: 'For parts or not working',
};

export const NOTIFICATION_LABELS: Record<NotificationMode, string> = {
  realtime: 'Real-time email',
  digest: 'Daily digest',
};

export const RELIST_LABELS: Record<RelistPolicy, string> = {
  show: 'Show, flagged as seen before',
  suppress: 'Hide',
};

export const ON_UNKNOWN_LABELS: Record<OnUnknown, string> = {
  surface: 'Surface as uncertain',
  reject: 'Reject',
};

export const SHIPS_TO_UK_LABELS: Record<ShipsToUkPolicy, string> = {
  show_all: 'Show everything',
  flag: 'Show everything, flagged',
  only: 'Only what ships to the UK',
};

export const BACKFILL_DEPTH_LABELS: Record<BackfillDepth, string> = {
  top_50: 'Newest 50',
  top_200: 'Newest 200',
  last_30_days: 'Last 30 days',
};
