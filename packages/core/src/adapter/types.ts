import type { z } from 'zod';
import type { BackfillDepth } from '../domain/constants.js';
import type { ListingImage, NormalisedListing, RawListingShape } from '../domain/listing.js';
import type { SearchPlan } from '../domain/spec.js';
import type { Logger } from '../logger.js';
import type { SourceId } from '../sources.js';

/**
 * The source adapter contract from ARCHITECTURE.md §5 — the extension point other people's
 * instances and contributions build against.
 *
 * Adapters never touch the database. Everything they need arrives on the `AdapterContext`, which
 * means an adapter is testable by handing it a context backed by recorded fixtures rather than a
 * network, and a broken marketplace is a one-package fix (§18).
 */

/**
 * What `search` returns: normalised enough to store, plus the source's own payload for debugging.
 * Inferred from `rawListingSchema` so the harness validates the exact shape adapters are typed to.
 */
export type RawListing = RawListingShape;

/**
 * What `enrich` returns. Structurally identical to `RawListing`: the difference is how much of it
 * is filled in — the full description and every image, rather than what a search result carried.
 */
export type EnrichedListing = RawListing;

/** Why a poll is running, which decides paging depth and how results are notified (§6, §10). */
export type PollMode = 'poll' | 'backfill' | 'scan';

/**
 * §5 writes this as `search(plan, since, ctx)`. It is an object here because §6 also requires the
 * mode and depth for a backfill, and a per-poll cap so a broad query like "game" cannot trigger
 * hundreds of reviews; three loose positional arguments would have become five.
 */
export interface SearchRequest {
  /** The plan's watermark. Null on a cold plan or a backfill, which pages by `cap` instead. */
  since: Date | null;
  /**
   * An upper bound on `listedAt`, exclusive: return nothing listed at or after it.
   *
   * Set only when the previous poll hit the cap. Sources page newest-first, so a capped poll
   * takes the newest N and leaves a gap between the watermark and that batch; without a ceiling
   * the next poll would fetch the same newest N again and the gap would never be reached. The
   * scheduler passes the oldest listing the last poll processed, so the window walks backwards
   * until it meets the watermark (§6).
   */
  until?: Date;
  mode: PollMode;
  /** Set when `mode` is not 'poll'. */
  depth?: BackfillDepth;
  /** Stop paging once this many new listings have been collected (§6: 50 polling, 200 backfilling). */
  cap: number;
}

export type HealthStatus = 'ok' | 'degraded' | 'blocked' | 'error';

export interface HealthResult {
  status: HealthStatus;
  /**
   * Shown on the dashboard and in the digest, so it is written for the person who has to act:
   * "blocked — run this worker from a residential connection or configure a proxy" (§5).
   */
  message: string;
  checkedAt: Date;
  /** Anything worth surfacing beside it — remaining quota, a proxy's exit IP and country. */
  details?: Record<string, unknown>;
}

/** One option a source accepts on a search plan, rendered as a form control by the UI. */
export interface SearchOptionDescriptor {
  key: string;
  label: string;
  type: 'boolean' | 'string' | 'number' | 'enum';
  /** Required when `type` is 'enum'. */
  values?: readonly { value: string; label: string }[];
  default?: unknown;
  description?: string;
}

/**
 * What the UI and the interviewer read to know which regions and options a source supports, so
 * neither has to hard-code a marketplace list (§4).
 */
export interface SearchOptionSchema {
  /** In the source's own vocabulary: `EBAY_GB`, `vinted.co.uk`, `jp`. */
  regions: readonly { value: string; label: string }[];
  options: readonly SearchOptionDescriptor[];
}

/**
 * A rate-limited HTTP client. One per source, so per-source concurrency and spacing are the
 * client's business rather than every adapter's.
 */
export interface HttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Resolves the address requests actually leave from — the proxy Test button in Settings (§5). */
  exitAddress(): Promise<{ ip: string; country?: string }>;
}

/**
 * Cookies that outlive the process. Vinted's DataDome cookie is the reason this is persisted
 * rather than held in memory: losing it on every restart is what gets a worker blocked (§5).
 */
export interface CookieJar {
  /** A `Cookie:` header value for this domain, or null if there is nothing stored. */
  header(domain: string): Promise<string | null>;
  /** Records `set-cookie` values verbatim; expired entries are dropped on read. */
  store(domain: string, setCookie: readonly string[]): Promise<void>;
  clear(domain?: string): Promise<void>;
}

/**
 * The slice of a browser page an adapter may use. Deliberately narrow and Playwright-free so
 * `packages/core` — and the slim image — never depend on a browser; Playwright's own `Page`
 * satisfies it structurally, and the worker supplies one. It will grow as Phase 4 needs it to.
 */
export interface BrowserPage {
  goto(
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
  ): Promise<unknown>;
  content(): Promise<string>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
}

/**
 * Hands out a page and takes it back. The implementation enforces one browser at a time and
 * closes it after each poll, because a headless Chromium costs 300–500 MB and the droplet has
 * 2 GB (§11).
 */
export interface BrowserFactory {
  withPage<T>(run: (page: BrowserPage) => Promise<T>): Promise<T>;
}

export interface AdapterContext {
  readonly source: SourceId;
  readonly http: HttpClient;
  readonly cookies: CookieJar;
  /** Null when this process has no browser — the slim image, or a worker polling no scraped source. */
  readonly browser: BrowserFactory | null;
  readonly logger: Logger;
  /** Validated against the adapter's own `credentialSchema` before it is handed over. */
  readonly credentials: Record<string, unknown>;
  /** Aborted on SIGTERM, so a long poll stops rather than holding up shutdown (P0-06). */
  readonly signal?: AbortSignal;
}

export interface SourceAdapter {
  readonly id: SourceId;
  readonly displayName: string;
  readonly requiresBrowser: boolean;
  /** ISO 8601, e.g. PT8H for Vinted and PT1H for eBay. The scheduler refuses to poll faster. */
  readonly recommendedMinInterval: string;
  /** What the user must configure in Settings for this source to work. */
  readonly credentialSchema: z.ZodType;

  /** Validates credentials and reachability; the Settings "Test" button calls this. */
  healthCheck(ctx: AdapterContext): Promise<HealthResult>;

  describeSearchOptions(): SearchOptionSchema;

  /** Listings newer than `request.since` for this plan. Must be idempotent. */
  search(plan: SearchPlan, request: SearchRequest, ctx: AdapterContext): Promise<RawListing[]>;

  /** Full description and every image. Only called for candidates that survive the pre-filter. */
  enrich(listing: RawListing, ctx: AdapterContext): Promise<EnrichedListing>;
}

export type { ListingImage, NormalisedListing, SearchPlan };
