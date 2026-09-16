import type { EnrichedListing, RawListing } from '../adapter/types.js';
import type { ShipsToUk } from '../domain/constants.js';
import type { WantedSpec } from '../domain/spec.js';
import type { CriterionResultEntry } from '../domain/verdict.js';
import type { SourceId } from '../sources.js';

/**
 * What the review pipeline needs from the outside world, as plain functions (§7).
 *
 * The pipeline lives in core because it is pipeline logic and it is the half worth testing against
 * a real database — the same reasoning as `poll/ingest.ts`. But core cannot import
 * `@goodies-beacon/ai` or `@goodies-beacon/email`: `ai` already depends on core, so the edge would
 * be a cycle, and `email` has no business being a dependency of the domain. So the model calls,
 * the adapter's `enrich` and the mail transport arrive as ports, the worker supplies the real
 * ones, and a test supplies fakes without a provider key or an SMTP server.
 */

export interface PrefilterPortRequest {
  listing: { title: string; description: string | null };
  spec: Pick<WantedSpec, 'summary' | 'plausibilityNote' | 'criteria'>;
  wantedItemId: string;
  candidateId: string;
}

export interface PrefilterPortResult {
  plausible: boolean;
  reason: string;
  costUsd: number;
  modelRef: string | null;
  usage: { inputTokens: number; outputTokens: number };
  /** True when nothing could be asked and the listing was kept anyway (§7 step 3 fails open). */
  failedOpen: boolean;
}

/** An image the reviewer is shown: bytes this instance already fetched under guard, never a URL. */
export interface ReviewPortImage {
  mediaId: string;
  label: string;
  bytes: Uint8Array;
  mediaType: string;
}

export interface ReviewPortRequest {
  listing: {
    title: string;
    description: string | null;
    price: string | null;
    url: string | null;
    images: readonly ReviewPortImage[];
  };
  spec: Pick<WantedSpec, 'summary' | 'criteria'>;
  referenceImages: readonly ReviewPortImage[];
  wantedItemId: string;
  candidateId: string;
}

export interface ReviewPortResult {
  criteriaResults: CriterionResultEntry[];
  englishSummary: string;
  shipsToUk: ShipsToUk;
  grade: string | null;
  promptText: string;
  promptImages: unknown[];
  costUsd: number;
  modelRef: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface NotificationMessage {
  subject: string;
  text: string;
}

export interface ReviewPorts {
  prefilter(request: PrefilterPortRequest): Promise<PrefilterPortResult>;
  review(request: ReviewPortRequest): Promise<ReviewPortResult>;
  /**
   * §7 step 4. Returns null when this process has no adapter for the source — a satellite worker,
   * or a source whose package is not installed — and the pipeline then reviews what the search
   * result carried rather than failing.
   */
  enrich(source: SourceId, listing: RawListing): Promise<EnrichedListing | null>;
  /** Sends one plain-text email. Absent when no SMTP is configured, which is not a failure. */
  sendEmail?: ((message: NotificationMessage) => Promise<void>) | undefined;
}
