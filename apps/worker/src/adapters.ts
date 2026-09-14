import type { MarketplaceSourceId, SourceAdapter } from '@goodies-beacon/core';
import { ebayAdapter } from '@goodies-beacon/source-ebay';

/**
 * Which package implements which marketplace.
 *
 * A partial record rather than a complete one: Vinted, Yahoo! Auctions and Mercari are named in
 * `MARKETPLACE_SOURCE_IDS` — they have queues, settings sections and spikes — but their adapters
 * arrive in Phase 4. A missing entry is a plan that cannot be polled and says so, which is better
 * than a stub that returns nothing and looks like a marketplace with no stock.
 */
export type AdapterRegistry = Partial<Record<MarketplaceSourceId, SourceAdapter>>;

export const adapters: AdapterRegistry = {
  ebay: ebayAdapter,
};

export class UnknownAdapterError extends Error {
  override readonly name = 'UnknownAdapterError';
}

export function adapterFor(source: MarketplaceSourceId, registry = adapters): SourceAdapter {
  const adapter = registry[source];
  if (!adapter) {
    throw new UnknownAdapterError(`no adapter is installed for ${source}`);
  }
  return adapter;
}
