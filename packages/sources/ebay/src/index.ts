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
} from '@goodies-beacon/core';
import { z } from 'zod';
import { deriveShipsToUk, type ShipToLocations } from './ships-to-uk.js';
import { createTokenCache, EbayAuthError } from './token.js';

/**
 * The eBay Browse API adapter (§5), written against what S1-01 actually measured rather than what
 * the documentation promises. `docs/SPIKES.md` has the evidence for each of the awkward bits.
 */

export const EBAY_API_BASE = 'https://api.ebay.com';

/** One plan per marketplace (§4). The "major sites" preset in §5 creates one of each. */
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
] as const;

/** Browse caps a page at 200; 50 keeps a single poll's payload small and the cap easy to honour. */
const PAGE_SIZE = 50;

export const ebayCredentialSchema = z.object({
  clientId: z.string().min(1, 'the App ID (Client ID) from your production keyset'),
  clientSecret: z.string().min(1, 'the Cert ID (Client Secret) beside it'),
});

interface EbayMoney {
  value?: string;
  currency?: string;
}

interface EbaySummary {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  itemWebUrl?: string;
  price?: EbayMoney | null;
  currentBidPrice?: EbayMoney | null;
  buyingOptions?: string[];
  itemLocation?: { country?: string };
  itemCreationDate?: string;
  itemEndDate?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
  additionalImages?: { imageUrl?: string }[];
  condition?: string;
  seller?: unknown;
  description?: string;
  shortDescription?: string;
  shipToLocations?: ShipToLocations;
}

interface SearchResponse {
  itemSummaries?: EbaySummary[];
  total?: number;
  next?: string;
  warnings?: unknown[];
}

const tokens = createTokenCache({ baseUrl: EBAY_API_BASE });

function credentialsFrom(ctx: AdapterContext): { clientId: string; clientSecret: string } {
  return ebayCredentialSchema.parse(ctx.credentials);
}

function saltFrom(ctx: AdapterContext): string {
  const salt = ctx.credentials.sellerSalt;
  if (typeof salt !== 'string' || salt.length === 0) {
    throw new Error('the adapter context is missing the instance seller salt');
  }
  return salt;
}

async function authorisedFetch(
  ctx: AdapterContext,
  url: string,
  marketplace: string,
): Promise<Response> {
  const { clientId, clientSecret } = credentialsFrom(ctx);
  const send = async (): Promise<Response> =>
    ctx.http.fetch(url, {
      headers: {
        authorization: `Bearer ${await tokens.get(ctx.http, clientId, clientSecret)}`,
        'X-EBAY-C-MARKETPLACE-ID': marketplace,
        accept: 'application/json',
      },
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

  const response = await send();
  // A live token can still be rejected — a revoked keyset, or a clock that drifted. One retry
  // with a fresh token distinguishes that from credentials that are actually wrong.
  if (response.status !== 401) return response;

  tokens.invalidate(clientId);
  return send();
}

/**
 * Auctions report `price: null` and put the figure in `currentBidPrice` (S1-01). An adapter that
 * reads only `price` hands the price-ceiling hard filter a null on every auction it ever sees.
 */
function moneyOf(item: EbaySummary): { amount: number | null; currency: string | null } {
  const money = item.price ?? item.currentBidPrice ?? null;
  const amount = money?.value === undefined ? null : Number(money.value);
  return {
    amount: amount === null || Number.isNaN(amount) ? null : amount,
    currency: money?.currency ?? null,
  };
}

function imagesOf(item: EbaySummary): { url: string; mediaId: null }[] {
  const urls = [
    item.image?.imageUrl,
    ...(item.additionalImages ?? []).map((image) => image.imageUrl),
    ...(item.thumbnailImages ?? []).map((image) => image.imageUrl),
  ].filter((url): url is string => typeof url === 'string' && url.length > 0);

  return [...new Set(urls)].map((url) => ({ url, mediaId: null }));
}

function toRawListing(item: EbaySummary, salt: string): RawListing {
  const { amount, currency } = moneyOf(item);
  const buying = item.buyingOptions ?? [];

  /**
   * The seller object never reaches `raw`. `getItem` returns `seller.sellerLegalInfo` for business
   * sellers — a trader's legal name, street address and email — and `raw` is stored verbatim and
   * appears in every nightly dump (§4, found by S1-01).
   */
  const { seller, ...rest } = item;
  const username =
    seller && typeof seller === 'object' && 'username' in seller
      ? (seller as { username?: unknown }).username
      : undefined;

  return {
    source: 'ebay',
    externalId: item.itemId ?? '',
    url: item.itemWebUrl ?? '',
    title: item.title ?? '',
    titleEn: null,
    description: item.description ?? item.shortDescription ?? null,
    descriptionEn: null,
    priceAmount: amount,
    priceCurrency: currency,
    priceGbp: null,
    priceRateDate: null,
    // An auction with Buy It Now carries both; it is an auction until the auction ends.
    buyingType: buying.includes('AUCTION') ? 'auction' : buying.length > 0 ? 'fixed' : null,
    sellerHash: typeof username === 'string' ? sellerHash('ebay', username, salt) : null,
    itemLocationCountry: item.itemLocation?.country ?? null,
    shipsToUk: deriveShipsToUk(item.shipToLocations),
    images: imagesOf(item),
    listedAt: item.itemCreationDate ? new Date(item.itemCreationDate) : null,
    endsAt: item.itemEndDate ? new Date(item.itemEndDate) : null,
    raw: rest as unknown as Record<string, unknown>,
  };
}

/**
 * Builds the `filter` parameter. `itemLocationCountry` is only ever given a single value: S1-01
 * found eBay answers 200 to the `{GB|US}` set form, returns the *unfiltered* total and a listing
 * from neither country — it parses the syntax and then ignores it. Two countries is two plans.
 */
export function buildFilter(plan: SearchPlan, since: Date | null): string {
  const parts: string[] = [];
  if (since) parts.push(`itemStartDate:[${since.toISOString()}]`);

  const options = plan.options as {
    buyingOptions?: string[];
    itemLocationCountry?: string;
    maxPrice?: number;
    priceCurrency?: string;
    conditions?: string[];
  };

  if (options.buyingOptions?.length) {
    parts.push(`buyingOptions:{${options.buyingOptions.join('|')}}`);
  }
  if (typeof options.itemLocationCountry === 'string' && options.itemLocationCountry) {
    parts.push(`itemLocationCountry:${options.itemLocationCountry}`);
  }
  if (typeof options.maxPrice === 'number') {
    parts.push(`price:[..${options.maxPrice}]`);
    parts.push(`priceCurrency:${options.priceCurrency ?? 'GBP'}`);
  }
  if (options.conditions?.length) parts.push(`conditions:{${options.conditions.join('|')}}`);

  return parts.join(',');
}

export const ebayAdapter: SourceAdapter = {
  id: 'ebay',
  displayName: 'eBay',
  requiresBrowser: false,
  /** Quota is 5,000 Browse calls a day (S1-01), so hourly is comfortable even with many plans. */
  recommendedMinInterval: 'PT1H',
  credentialSchema: ebayCredentialSchema,

  async healthCheck(ctx: AdapterContext): Promise<HealthResult> {
    const checkedAt = new Date();
    try {
      const url = new URL(`${EBAY_API_BASE}/buy/browse/v1/item_summary/search`);
      url.searchParams.set('q', 'test');
      url.searchParams.set('limit', '1');
      const response = await authorisedFetch(ctx, url.toString(), 'EBAY_GB');

      if (!response.ok) {
        return {
          status: response.status === 403 ? 'blocked' : 'error',
          message: `search returned HTTP ${response.status}`,
          checkedAt,
        };
      }

      const quota = await readQuota(ctx);
      const spent = quota && quota.limit > 0 ? 1 - quota.remaining / quota.limit : 0;
      return {
        status: spent > 0.9 ? 'degraded' : 'ok',
        message: quota
          ? `search answered; ${quota.remaining} of ${quota.limit} Browse calls left today`
          : 'search answered',
        checkedAt,
        ...(quota ? { details: { quota } } : {}),
      };
    } catch (cause) {
      return {
        status: cause instanceof EbayAuthError ? 'error' : 'error',
        message: cause instanceof Error ? cause.message : String(cause),
        checkedAt,
      };
    }
  },

  describeSearchOptions(): SearchOptionSchema {
    return {
      regions: EBAY_MARKETPLACES,
      options: [
        {
          key: 'itemLocationCountry',
          label: 'Only sellers located in',
          type: 'string',
          description:
            'ISO country code, one only. Off by default: an eBay marketplace returns the whole world, and the reviewer reports ships-to-UK anyway. eBay accepts a {GB|US} set and silently ignores it, so two countries means two plans.',
        },
        {
          key: 'conditions',
          label: 'Condition',
          type: 'enum',
          values: [
            { value: 'NEW', label: 'New' },
            { value: 'USED', label: 'Used' },
            { value: 'UNSPECIFIED', label: 'Unspecified' },
          ],
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
    // A backfill deliberately has no watermark: it asks what is listed right now (§6).
    const since = request.mode === 'poll' ? request.since : null;

    const first = new URL(`${EBAY_API_BASE}/buy/browse/v1/item_summary/search`);
    first.searchParams.set('q', plan.query);
    first.searchParams.set('sort', 'newlyListed');
    first.searchParams.set('limit', String(Math.min(PAGE_SIZE, request.cap)));
    const filter = buildFilter(plan, since);
    if (filter) first.searchParams.set('filter', filter);

    let url: string | null = first.toString();

    while (url && collected.length < request.cap) {
      const response = await authorisedFetch(ctx, url, plan.region);
      if (!response.ok) {
        throw new Error(`eBay search failed: HTTP ${response.status}`);
      }
      const page = (await response.json()) as SearchResponse;

      for (const item of page.itemSummaries ?? []) {
        const listing = toRawListing(item, salt);
        /**
         * Results are newest-first, so the first listing at or before the watermark means the
         * rest are older still. Returning here rather than filtering afterwards is what stops a
         * broad query spending requests on listings it will throw away.
         */
        if (since && listing.listedAt && listing.listedAt <= since) return collected;
        collected.push(listing);
        if (collected.length >= request.cap) return collected;
      }

      url = page.next ?? null;
    }

    return collected;
  },

  async enrich(listing: RawListing, ctx: AdapterContext): Promise<EnrichedListing> {
    const url = `${EBAY_API_BASE}/buy/browse/v1/item/${encodeURIComponent(listing.externalId)}`;
    const response = await authorisedFetch(ctx, url, 'EBAY_GB');
    if (!response.ok) throw new Error(`eBay getItem failed: HTTP ${response.status}`);

    const item = (await response.json()) as EbaySummary;
    const enriched = toRawListing(item, saltFrom(ctx));

    // getItem carries no `itemCreationDate` for every listing, and the search result's currency
    // conversion has already been applied, so what search knew is kept where getItem is silent.
    return {
      ...enriched,
      listedAt: enriched.listedAt ?? listing.listedAt,
      priceGbp: listing.priceGbp,
      priceRateDate: listing.priceRateDate,
    };
  },
};

async function readQuota(
  ctx: AdapterContext,
): Promise<{ limit: number; remaining: number; resetsAt: string | null } | null> {
  try {
    const url = `${EBAY_API_BASE}/developer/analytics/v1_beta/rate_limit/?api_name=browse&api_context=buy`;
    const response = await authorisedFetch(ctx, url, 'EBAY_GB');
    // Sandbox answers 204 with no body (S1-01); a missing quota is not a health failure.
    if (!response.ok || response.status === 204) return null;

    const body = (await response.json()) as {
      rateLimits?: {
        resources?: { rates?: { limit?: number; remaining?: number; reset?: string }[] }[];
      }[];
    };
    const rate = body.rateLimits?.[0]?.resources?.[0]?.rates?.[0];
    if (!rate || typeof rate.limit !== 'number' || typeof rate.remaining !== 'number') return null;

    return { limit: rate.limit, remaining: rate.remaining, resetsAt: rate.reset ?? null };
  } catch {
    return null;
  }
}

export default ebayAdapter;
