import {
  type AdapterContext,
  type EnrichedListing,
  type HealthResult,
  type RawListing,
  type SearchOptionSchema,
  type SearchPlan,
  type SearchRequest,
  type SourceAdapter,
  sellerHash,
  TEMPLATE_SOURCE_ID,
} from '@goodies-beacon/core';
import { z } from 'zod';

/**
 * A working source adapter that talks to a marketplace which does not exist.
 *
 * Copy this directory to `packages/sources/<id>` to start a real one. It is deliberately complete
 * rather than a stub: it implements every method of the contract, is exercised by the fixture
 * harness, and demonstrates the three things that are easy to get wrong — hashing the seller and
 * dropping the rest, normalising a price an auction reports differently, and stopping at the
 * watermark. See `docs/ADAPTERS.md`.
 */

const BASE_URL = 'https://fixtures.example.invalid';

/** What the user must configure in Settings for this source to work (§5). */
export const templateCredentialSchema = z.object({
  apiKey: z.string().min(1, 'an API key is required'),
});

/** The marketplace's own response shape, which is the adapter's job to know and nobody else's. */
interface TemplateListing {
  id: string;
  name: string;
  price: { amount: string; currency: string } | null;
  currentBid?: { amount: string; currency: string };
  kind: 'auction' | 'fixed';
  endsAt?: string;
  seller: { handle: string };
  country: string;
  thumbnail?: string;
  photos?: string[];
  descriptionHtml?: string;
  shipsTo?: string[];
  listedAt: string;
  link: string;
}

function toRawListing(item: TemplateListing, salt: string): RawListing {
  /**
   * An auction reports no `price`; the figure is in `currentBid`. eBay does the same thing
   * (S1-01), and an adapter that reads only `price` hands the price-ceiling filter a null on
   * every auction it ever sees.
   */
  const money = item.price ?? item.currentBid ?? null;

  const { seller, ...rest } = item;

  return {
    source: TEMPLATE_SOURCE_ID,
    externalId: item.id,
    url: item.link,
    title: item.name,
    titleEn: null,
    description: item.descriptionHtml ?? null,
    descriptionEn: null,
    priceAmount: money ? Number(money.amount) : null,
    priceCurrency: money?.currency ?? null,
    priceGbp: null,
    priceRateDate: null,
    buyingType: item.kind,
    // Hashed here, and the seller object is dropped from `raw` below, so no username or
    // trader's address is ever stored (ARCHITECTURE.md §4).
    sellerHash: sellerHash(TEMPLATE_SOURCE_ID, seller.handle, salt),
    itemLocationCountry: item.country,
    shipsToUk: item.shipsTo ? (item.shipsTo.includes('GB') ? 'yes' : 'no') : 'unknown',
    images: (item.photos ?? (item.thumbnail ? [item.thumbnail] : [])).map((url) => ({
      url,
      mediaId: null,
    })),
    listedAt: new Date(item.listedAt),
    endsAt: item.endsAt ? new Date(item.endsAt) : null,
    raw: rest as unknown as Record<string, unknown>,
  };
}

/** The salt is per instance; the harness passes a fixed one so fixtures stay comparable. */
function saltFrom(ctx: AdapterContext): string {
  const salt = ctx.credentials.sellerSalt;
  return typeof salt === 'string' ? salt : 'template-fixture-salt';
}

export const templateAdapter: SourceAdapter = {
  id: TEMPLATE_SOURCE_ID,
  displayName: 'Template (fixture data)',
  requiresBrowser: false,
  recommendedMinInterval: 'PT1H',
  credentialSchema: templateCredentialSchema,

  async healthCheck(ctx: AdapterContext): Promise<HealthResult> {
    const response = await ctx.http.fetch(`${BASE_URL}/search?q=ping&limit=1`);
    if (!response.ok) {
      return {
        status: response.status === 403 ? 'blocked' : 'error',
        message: `search returned HTTP ${response.status}`,
        checkedAt: new Date(),
      };
    }
    return { status: 'ok', message: 'search answered', checkedAt: new Date() };
  },

  describeSearchOptions(): SearchOptionSchema {
    return {
      regions: [{ value: 'example', label: 'Example region' }],
      options: [
        {
          key: 'includeSold',
          label: 'Include sold listings',
          type: 'boolean',
          default: false,
          description: 'Off by default; sold listings cannot be bought.',
        },
      ],
    };
  },

  async search(
    plan: SearchPlan,
    request: SearchRequest,
    ctx: AdapterContext,
  ): Promise<RawListing[]> {
    const salt = saltFrom(ctx);
    const collected: RawListing[] = [];
    let offset: number | null = 0;

    while (offset !== null && collected.length < request.cap) {
      const url = new URL(`${BASE_URL}/search`);
      url.searchParams.set('q', plan.query);
      url.searchParams.set('region', plan.region);
      url.searchParams.set('sort', 'newest');
      url.searchParams.set('offset', String(offset));
      if (request.since) url.searchParams.set('since', request.since.toISOString());
      // The ceiling a capped run leaves behind, so the next one walks the gap it skipped (§6).
      if (request.until) url.searchParams.set('before', request.until.toISOString());

      const response = await ctx.http.fetch(url.toString());
      if (!response.ok) throw new Error(`search failed: HTTP ${response.status}`);
      const page = (await response.json()) as {
        results: TemplateListing[];
        nextOffset: number | null;
      };

      for (const item of page.results) {
        const listing = toRawListing(item, salt);
        /**
         * Stop at the watermark rather than filtering afterwards: results are newest-first, so
         * everything past the first old one is older still, and paging on would spend requests
         * to collect listings that are then thrown away.
         */
        if (request.since && listing.listedAt && listing.listedAt <= request.since) {
          return collected;
        }
        // Exclusive, so the previous run's oldest listing is not ingested a second time.
        if (request.until && listing.listedAt && listing.listedAt >= request.until) continue;
        collected.push(listing);
        if (collected.length >= request.cap) break;
      }

      offset = page.nextOffset;
    }

    return collected;
  },

  async enrich(listing: RawListing, ctx: AdapterContext): Promise<EnrichedListing> {
    const response = await ctx.http.fetch(`${BASE_URL}/listing/${listing.externalId}`);
    if (!response.ok) throw new Error(`enrich failed: HTTP ${response.status}`);
    const item = (await response.json()) as TemplateListing;

    return { ...toRawListing(item, saltFrom(ctx)), priceGbp: listing.priceGbp };
  },
};

export default templateAdapter;
