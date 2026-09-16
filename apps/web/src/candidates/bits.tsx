import type { VerdictDecision } from '@goodies-beacon/core/schemas';
import type { ListingLike } from '../api/candidates.js';

/**
 * The small pieces both the candidate list and the candidate page render the same way.
 *
 * A rejection gets the same treatment as a match — a chip, a reason, the same evidence — because
 * requirement 6 is that the audit view is as browsable as the matches. Colour distinguishes them;
 * nothing hides them.
 */

const CHIPS: Record<VerdictDecision | 'pending', string> = {
  match: 'bg-emerald-600 text-white',
  uncertain: 'bg-amber-500 text-white',
  reject: 'bg-stone-500 text-white',
  pending: 'border border-edge dark:border-edge-dark',
};

const LABELS: Record<VerdictDecision | 'pending', string> = {
  match: 'Match',
  uncertain: 'Uncertain',
  reject: 'Rejected',
  pending: 'Not yet judged',
};

export function DecisionChip({ decision }: { decision: VerdictDecision | null }) {
  const key = decision ?? 'pending';

  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide ${CHIPS[key]}`}
    >
      {LABELS[key]}
    </span>
  );
}

/** What stopped it before a model was asked, in words rather than in the enum's own terms. */
export const REJECTION_REASONS: Record<string, string> = {
  over_budget: 'over the price ceiling',
  negative_keyword: 'a negative keyword in the title',
  prefilter: 'discarded by the pre-filter',
};

/**
 * Price in GBP with the original beside it when they differ (§10 asks emails for both, and the
 * page it links to should not say less).
 */
export function price(listing: ListingLike): string {
  const gbp = listing.priceGbp === null ? null : `£${Number(listing.priceGbp).toFixed(2)}`;
  const original =
    listing.priceAmount !== null && listing.priceCurrency
      ? `${listing.priceCurrency} ${Number(listing.priceAmount).toFixed(2)}`
      : null;

  if (gbp === null) return original ?? 'no price';
  if (original === null || listing.priceCurrency === 'GBP') return gbp;
  return `${gbp} (${original})`;
}

const SHIPS_TO_UK: Record<string, string> = {
  yes: 'ships to the UK',
  no: 'does not ship to the UK',
  unknown: 'UK shipping unknown',
};

/**
 * Source, location, listing type and the ships-to-UK flag. §1 is explicit that a listing which
 * does not ship here is shown and flagged rather than filtered out, so this says which it is
 * every time rather than only when the answer is bad.
 */
export function Provenance({ listing }: { listing: ListingLike }) {
  const parts = [
    listing.source,
    listing.buyingType === 'auction'
      ? 'auction'
      : listing.buyingType === 'fixed'
        ? 'fixed price'
        : null,
    listing.itemLocationCountry,
    SHIPS_TO_UK[listing.shipsToUk],
  ].filter((part): part is string => Boolean(part));

  return (
    <span className={listing.shipsToUk === 'no' ? 'text-amber-700 dark:text-amber-500' : undefined}>
      {parts.join(' · ')}
    </span>
  );
}

/** The stored, downscaled photograph; there is no fallback to the marketplace's own URL (§12). */
export function Thumbnail({ mediaId, alt }: { mediaId: string | undefined; alt: string }) {
  if (!mediaId) {
    return (
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-edge text-[0.625rem] text-ink-dim dark:border-edge-dark dark:text-ink-dim-dark">
        no photo
      </div>
    );
  }

  return (
    <img
      src={`/api/media/${mediaId}/thumb`}
      alt={alt}
      loading="lazy"
      className="h-20 w-20 shrink-0 rounded-lg border border-edge object-cover dark:border-edge-dark"
    />
  );
}
