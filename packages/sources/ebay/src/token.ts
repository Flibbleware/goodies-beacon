import type { HttpClient } from '@goodies-beacon/core';

/**
 * The application token from client credentials (§5), cached and refreshed before it expires.
 *
 * S1-01 measured a two-hour life and a 5,000-call daily quota, so re-authenticating on every
 * search would spend a meaningful slice of the allowance on nothing. The cache is keyed by client
 * id so two instances in one process — which only happens in tests — do not share a token.
 */

/** Refresh this far ahead of expiry, so a request never leaves with a token about to die. */
export const REFRESH_MARGIN_MS = 60_000;

/** The scope identifier is the production URL in both environments; sandbox does not have its own. */
const SCOPE = 'https://api.ebay.com/oauth/api_scope';

export interface TokenCacheOptions {
  baseUrl: string;
  now?: () => number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class EbayAuthError extends Error {
  override readonly name = 'EbayAuthError';
}

export function createTokenCache(options: TokenCacheOptions) {
  const now = options.now ?? Date.now;
  const cache = new Map<string, CachedToken>();
  /** In-flight requests per client id, so two concurrent searches ask for one token, not two. */
  const pending = new Map<string, Promise<string>>();

  async function request(http: HttpClient, id: string, secret: string): Promise<string> {
    const response = await http.fetch(`${options.baseUrl}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString(),
    });

    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    } | null;

    if (!response.ok || !body?.access_token) {
      const detail = body?.error_description ?? `HTTP ${response.status}`;
      throw new EbayAuthError(`eBay refused the credentials: ${detail}`);
    }

    cache.set(id, {
      token: body.access_token,
      expiresAt: now() + (body.expires_in ?? 7200) * 1000,
    });
    return body.access_token;
  }

  return {
    async get(http: HttpClient, id: string, secret: string): Promise<string> {
      const cached = cache.get(id);
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) return cached.token;

      const inFlight = pending.get(id);
      if (inFlight) return inFlight;

      const attempt = request(http, id, secret).finally(() => pending.delete(id));
      pending.set(id, attempt);
      return attempt;
    },

    /** Forces the next call to re-authenticate. Used when eBay answers 401 despite a live token. */
    invalidate(id: string): void {
      cache.delete(id);
    },
  };
}
