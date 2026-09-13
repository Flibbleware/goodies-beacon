import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from 'undici';
import type { HttpClient } from './types.js';

/**
 * One rate-limited HTTP client per source (§5).
 *
 * Spacing and concurrency live here rather than in each adapter, so "be polite" is not something
 * four adapters each have to remember and one of them gets wrong. The delay is jittered because
 * a fixed interval is itself a fingerprint: requests landing exactly 1.500s apart look like a
 * script, which is the thing the scraped sources score against (§2).
 */

export interface HttpClientOptions {
  /** Requests in flight at once. 1 for the scraped sources; eBay allows more but does not need it. */
  concurrency?: number;
  /** Inclusive bounds on the pause between requests, in milliseconds. */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** `http://user:pass@host:port` or a SOCKS5 URL. Applied to every request (§5). */
  proxyUrl?: string | undefined;
  /** Per-request timeout; a hung socket must not hold a poll open forever. */
  timeoutMs?: number;
  userAgent?: string;
  /** Injected so the spacing can be tested with a fake clock rather than by waiting. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  fetchImpl?: typeof fetch;
  exitAddressUrl?: string;
}

export const DEFAULT_MIN_DELAY_MS = 800;
export const DEFAULT_MAX_DELAY_MS = 2500;
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Asked by the proxy Test button; returns the address the request actually left from.
 * Overridable so a test can point it somewhere local, and so an operator behind a restrictive
 * network can name a service they can actually reach.
 */
export const DEFAULT_EXIT_ADDRESS_URL = 'https://ipinfo.io/json';

export interface RateLimitedClient extends HttpClient {
  /** Releases the proxy agent's sockets. Called when a poll finishes. */
  close(): Promise<void>;
}

export function createHttpClient(options: HttpClientOptions = {}): RateLimitedClient {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
  const maxDelayMs = Math.max(minDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  /**
   * undici's own `fetch`, not the global one. They are the same library but different copies, and
   * a `ProxyAgent` built here is rejected by the global fetch with `invalid onRequestStart method`
   * — so the proxy would silently never apply. Using one copy for both keeps them compatible.
   */
  const doFetch =
    options.fetchImpl ??
    ((url: string, init: RequestInit) =>
      undiciFetch(url, init as never) as unknown as Promise<Response>);

  const dispatcher: Dispatcher | undefined = options.proxyUrl
    ? new ProxyAgent(options.proxyUrl)
    : undefined;

  let active = 0;
  const waiting: (() => void)[] = [];
  /** When the next request may start. Shared across slots, so spacing survives concurrency > 1. */
  let nextAllowedAt = 0;

  const acquire = async (): Promise<void> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
  };

  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };

  const pace = async (): Promise<void> => {
    const delay = minDelayMs + Math.floor(random() * (maxDelayMs - minDelayMs + 1));
    const wait = Math.max(0, nextAllowedAt - now());
    // Reserved before sleeping, so two callers racing here do not both aim at the same slot.
    nextAllowedAt = Math.max(nextAllowedAt, now()) + delay;
    if (wait > 0) await sleep(wait);
  };

  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    await acquire();
    try {
      await pace();
      const headers = new Headers(init.headers);
      if (options.userAgent && !headers.has('user-agent')) {
        headers.set('user-agent', options.userAgent);
      }
      return await doFetch(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
        ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {}),
      } as RequestInit);
    } finally {
      release();
    }
  };

  return {
    fetch: request,
    async exitAddress() {
      const response = await request(options.exitAddressUrl ?? DEFAULT_EXIT_ADDRESS_URL);
      if (!response.ok) throw new Error(`exit address lookup failed: HTTP ${response.status}`);
      const body = (await response.json()) as { ip?: string; country?: string };
      if (!body.ip) throw new Error('exit address lookup returned no ip');
      return body.country ? { ip: body.ip, country: body.country } : { ip: body.ip };
    },
    async close() {
      await dispatcher?.close();
    },
  };
}
