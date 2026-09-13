import { z } from 'zod';
import { SOURCE_IDS } from '../sources.js';
import { BUYING_TYPES, SHIPS_TO_UK } from './constants.js';

/**
 * A listing as the pipeline sees it, after the adapter has normalised it (§4).
 *
 * There is no seller name and no seller id — only `sellerHash`, and nothing here will take one.
 * The adapter computes the hash and drops the source's whole seller object before anything is
 * stored, because a marketplace response can carry a trader's legal name and street address
 * (found by S1-01, see `docs/SPIKES.md`).
 */

export const listingImageSchema = z.object({
  url: z.url(),
  /** Set once the image has been fetched, downscaled and stored by P1-05. */
  mediaId: z.uuid().nullable().default(null),
});

export const normalisedListingSchema = z.object({
  source: z.enum(SOURCE_IDS),
  externalId: z.string().min(1),
  url: z.url(),
  title: z.string().min(1),
  titleEn: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  descriptionEn: z.string().nullable().default(null),
  /**
   * Null is legitimate, not a bug: an eBay auction reports no `price` and puts the figure in
   * `currentBidPrice`, so an adapter that forgets to normalise the two hands the price-ceiling
   * filter a null. S1-01 found this; the hard filter in §7 step 2 must treat null as "unknown
   * price" rather than "free".
   */
  priceAmount: z.number().nonnegative().nullable().default(null),
  priceCurrency: z.string().length(3).nullable().default(null),
  priceGbp: z.number().nonnegative().nullable().default(null),
  priceRateDate: z.string().nullable().default(null),
  buyingType: z.enum(BUYING_TYPES).nullable().default(null),
  sellerHash: z.string().nullable().default(null),
  itemLocationCountry: z.string().length(2).nullable().default(null),
  /** Only knowable after enrichment on eBay, where it comes from `shipToLocations` (S1-01). */
  shipsToUk: z.enum(SHIPS_TO_UK).default('unknown'),
  images: z.array(listingImageSchema).default([]),
  listedAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
});

export type ListingImage = z.infer<typeof listingImageSchema>;
export type NormalisedListing = z.infer<typeof normalisedListingSchema>;
