import {
  type AdapterContext,
  type BrowserFactory,
  type Config,
  createCookieJar,
  createHttpClient,
  type Database,
  type Logger,
  loadSellerSalt,
  type MarketplaceSourceId,
  type RateLimitedClient,
  resolveEbay,
  type Settings,
  type SourceAdapter,
} from '@goodies-beacon/core';

/**
 * Building the `AdapterContext` an adapter is handed (§5).
 *
 * The adapter knows one marketplace; everything else — credentials, pacing, the proxy, the
 * cookies, the salt — is assembled here, which is what keeps an adapter testable against recorded
 * fixtures and free of the database.
 */

export class SourceNotConfiguredError extends Error {
  override readonly name = 'SourceNotConfiguredError';
}

/**
 * Per-source politeness, since the contract has no field for it.
 *
 * An API with a published quota can be asked briskly; a site being scraped cannot, and §5 puts
 * Vinted at 0.8–2.5 s with low concurrency. The default is the cautious one, so a source added
 * without a thought here is polite rather than fast.
 */
const PACING: Partial<Record<MarketplaceSourceId, { minDelayMs: number; maxDelayMs: number }>> = {
  ebay: { minDelayMs: 100, maxDelayMs: 400 },
};

const USER_AGENT = 'goodies-beacon (+https://github.com/Flibbleware/goodies-beacon)';

export interface AdapterContextDeps {
  readonly db: Database;
  readonly config: Config;
  readonly logger: Logger;
  readonly settings: Settings;
  readonly source: MarketplaceSourceId;
  readonly adapter: SourceAdapter;
  readonly browser: BrowserFactory | null;
  readonly signal?: AbortSignal;
}

export interface OpenContext {
  readonly ctx: AdapterContext;
  /** Releases the client's sockets, including a proxy agent's. Always called once the poll ends. */
  close(): Promise<void>;
}

export async function createAdapterContext(deps: AdapterContextDeps): Promise<OpenContext> {
  const { db, config, logger, settings, source, adapter } = deps;

  const { credentials, proxyUrl } = credentialsFor(settings, source, config.secretKey);

  /**
   * Validated here rather than inside the adapter, so a keyset that was never filled in fails
   * with "eBay is not configured" at the top of the poll instead of as a parse error several
   * requests in (§5: "validated against your credentialSchema before you see it").
   */
  const validated = adapter.credentialSchema.safeParse(credentials);
  if (!validated.success) {
    throw new SourceNotConfiguredError(
      `${adapter.displayName} is not configured: set its credentials in Settings`,
    );
  }

  if (adapter.requiresBrowser && !deps.browser) {
    throw new SourceNotConfiguredError(
      `${adapter.displayName} needs a browser, and this process has none — run it from the full image`,
    );
  }

  const pacing = PACING[source];
  const http: RateLimitedClient = createHttpClient({
    concurrency: 1,
    userAgent: USER_AGENT,
    ...pacing,
    ...(proxyUrl ? { proxyUrl } : {}),
  });

  const ctx: AdapterContext = {
    source,
    http,
    cookies: createCookieJar(db, source),
    browser: deps.browser,
    logger: logger.child({ source }),
    // The salt is not a credential the user sets, but an adapter needs it to hash a seller and
    // the context is the only thing it is given (§4).
    credentials: { ...credentials, sellerSalt: await loadSellerSalt(db, config.secretKey) },
    ...(deps.signal ? { signal: deps.signal } : {}),
  };

  return { ctx, close: () => http.close() };
}

/**
 * The stored credentials for one source, decrypted.
 *
 * Only eBay has a settings section so far; the others get one with their adapter in Phase 4. An
 * unknown source returns nothing, which the `credentialSchema` check above turns into a clear
 * "not configured" rather than a poll that runs unauthenticated and fails obscurely.
 */
function credentialsFor(
  settings: Settings,
  source: MarketplaceSourceId,
  secretKey: string,
): { credentials: Record<string, unknown>; proxyUrl: string } {
  if (source === 'ebay') {
    const ebay = resolveEbay(settings, secretKey);
    if (!ebay) return { credentials: {}, proxyUrl: '' };
    return {
      credentials: { clientId: ebay.clientId, clientSecret: ebay.clientSecret },
      proxyUrl: ebay.proxyUrl,
    };
  }

  return { credentials: {}, proxyUrl: '' };
}
