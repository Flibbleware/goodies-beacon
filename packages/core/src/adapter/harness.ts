import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawListingSchema } from '../domain/listing.js';
import type { SearchPlan } from '../domain/spec.js';
import { createSilentLogger, type Logger } from '../logger.js';
import { createMemoryCookieJar } from './cookies.js';
import type {
  AdapterContext,
  BrowserFactory,
  CookieJar,
  EnrichedListing,
  HealthResult,
  HttpClient,
  RawListing,
  SearchRequest,
  SourceAdapter,
} from './types.js';

/**
 * Replays recorded fixtures through an adapter (P1-03).
 *
 * Adapter tests must run offline, without credentials, in a stranger's fork — so the network is
 * replaced rather than mocked per-test, and every response comes from a file the spike recorded.
 * The harness validates what comes back against `rawListingSchema`, which is the part that earns
 * its keep: an adapter that parses a page but produces something the pipeline cannot store fails
 * here rather than three stages later in a poll.
 */

export interface FixtureRoute {
  /** A substring of the URL, a pattern, or a predicate. First match wins, so order them. */
  match: string | RegExp | ((url: string) => boolean);
  /** File under `fixturesDir`. Mutually exclusive with `body`. */
  fixture?: string;
  /** An inline response, for the cases a file would be silly — an error, an empty page. */
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
}

export interface HarnessOptions {
  adapter: SourceAdapter;
  fixturesDir: string;
  routes: readonly FixtureRoute[];
  credentials?: Record<string, unknown>;
  cookies?: CookieJar;
  browser?: BrowserFactory | null;
  logger?: Logger;
}

export interface Harness {
  readonly ctx: AdapterContext;
  /** Every URL requested, in order — so a test can assert on paging and filters. */
  readonly requests: readonly string[];
  search(plan: SearchPlan, request?: Partial<SearchRequest>): Promise<RawListing[]>;
  enrich(listing: RawListing): Promise<EnrichedListing>;
  healthCheck(): Promise<HealthResult>;
}

export class UnmatchedRequestError extends Error {
  override readonly name = 'UnmatchedRequestError';
}

function matches(route: FixtureRoute, url: string): boolean {
  if (typeof route.match === 'string') return url.includes(route.match);
  if (route.match instanceof RegExp) return route.match.test(url);
  return route.match(url);
}

export function createHarness(options: HarnessOptions): Harness {
  const requests: string[] = [];
  const logger = options.logger ?? createSilentLogger();

  const http: HttpClient = {
    async fetch(url) {
      requests.push(url);
      const route = options.routes.find((candidate) => matches(candidate, url));

      /**
       * A request with no fixture is a test that would have hit the network, so it fails loudly
       * and names the URL. Falling through to an empty response would turn a missing recording
       * into a passing test that proves nothing.
       */
      if (!route) {
        throw new UnmatchedRequestError(
          `no fixture matches ${url}. Add a route to the harness, or record the response.`,
        );
      }

      // Read once into a local: a route may expose `fixture` as a getter to serve a sequence of
      // pages, and testing it for undefined and then reading it again would consume two.
      const fixture = route.fixture;
      const payload =
        fixture !== undefined
          ? readFileSync(join(options.fixturesDir, fixture), 'utf8')
          : JSON.stringify(route.body ?? null);

      return new Response(payload, {
        status: route.status ?? 200,
        headers: { 'content-type': 'application/json', ...route.headers },
      });
    },

    async exitAddress() {
      return { ip: '203.0.113.1', country: 'GB' };
    },
  };

  const ctx: AdapterContext = {
    source: options.adapter.id,
    http,
    cookies: options.cookies ?? createMemoryCookieJar(),
    browser: options.browser ?? null,
    logger,
    credentials: options.credentials ?? {},
  };

  /** The contract check. Every adapter's output goes through it, so none can skip it. */
  const validate = (listings: readonly unknown[], stage: string): RawListing[] =>
    listings.map((listing, index) => {
      const result = rawListingSchema.safeParse(listing);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ');
        throw new Error(`${stage} returned an unusable listing at index ${index} — ${issues}`);
      }
      return result.data;
    });

  return {
    ctx,
    requests,

    async search(plan, request) {
      const full: SearchRequest = { since: null, mode: 'poll', cap: 200, ...request };
      return validate(await options.adapter.search(plan, full, ctx), 'search');
    },

    async enrich(listing) {
      const [validated] = validate([await options.adapter.enrich(listing, ctx)], 'enrich');
      if (!validated) throw new Error('enrich returned nothing');
      return validated;
    },

    healthCheck() {
      return options.adapter.healthCheck(ctx);
    },
  };
}
