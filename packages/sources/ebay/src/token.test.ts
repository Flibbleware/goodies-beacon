import type { HttpClient } from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { createTokenCache, EbayAuthError, REFRESH_MARGIN_MS } from './token.js';

function stubHttp(respond: () => { status: number; body: unknown }) {
  const calls: string[] = [];
  const http: HttpClient = {
    async fetch(url) {
      calls.push(url);
      const { status, body } = respond();
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
    async exitAddress() {
      return { ip: '203.0.113.1' };
    },
  };
  return { http, calls };
}

const ok = () => ({ status: 200, body: { access_token: 'token-1', expires_in: 7200 } });

describe('the eBay token cache', () => {
  it('asks eBay once and reuses the token', async () => {
    const { http, calls } = stubHttp(ok);
    const cache = createTokenCache({ baseUrl: 'https://api.ebay.test' });

    await expect(cache.get(http, 'client-a', 'secret')).resolves.toBe('token-1');
    await expect(cache.get(http, 'client-a', 'secret')).resolves.toBe('token-1');

    expect(calls).toHaveLength(1);
  });

  it('sends client credentials as Basic auth with the api_scope', async () => {
    let seen: RequestInit | undefined;
    const http: HttpClient = {
      async fetch(_url, init) {
        seen = init;
        return new Response(JSON.stringify(ok().body));
      },
      async exitAddress() {
        return { ip: '203.0.113.1' };
      },
    };

    await createTokenCache({ baseUrl: 'https://api.ebay.test' }).get(http, 'id', 'secret');

    const headers = new Headers(seen?.headers);
    expect(headers.get('authorization')).toBe(`Basic ${btoa('id:secret')}`);
    expect(String(seen?.body)).toContain('grant_type=client_credentials');
    expect(String(seen?.body)).toContain('api_scope');
  });

  it('refreshes before the token expires rather than after it has', async () => {
    let clock = 0;
    const { http, calls } = stubHttp(() => ({
      status: 200,
      body: { access_token: `token-${calls.length}`, expires_in: 7200 },
    }));
    const cache = createTokenCache({ baseUrl: 'https://api.ebay.test', now: () => clock });

    await cache.get(http, 'client-a', 'secret');
    // One millisecond inside the refresh margin: still the old token.
    clock = 7_200_000 - REFRESH_MARGIN_MS - 1;
    await cache.get(http, 'client-a', 'secret');
    expect(calls).toHaveLength(1);

    // One millisecond past it: a new one, while the old is still technically valid.
    clock = 7_200_000 - REFRESH_MARGIN_MS + 1;
    await cache.get(http, 'client-a', 'secret');
    expect(calls).toHaveLength(2);
  });

  it('asks once when two searches start at the same moment', async () => {
    const { http, calls } = stubHttp(ok);
    const cache = createTokenCache({ baseUrl: 'https://api.ebay.test' });

    const [a, b] = await Promise.all([
      cache.get(http, 'client-a', 'secret'),
      cache.get(http, 'client-a', 'secret'),
    ]);

    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('keeps two keysets apart', async () => {
    const { http, calls } = stubHttp(() => ({
      status: 200,
      body: { access_token: `token-${calls.length}`, expires_in: 7200 },
    }));
    const cache = createTokenCache({ baseUrl: 'https://api.ebay.test' });

    await expect(cache.get(http, 'client-a', 'secret')).resolves.toBe('token-1');
    await expect(cache.get(http, 'client-b', 'secret')).resolves.toBe('token-2');
  });

  it('reports what eBay said when it refuses the credentials', async () => {
    const { http } = stubHttp(() => ({
      status: 401,
      body: { error_description: 'client authentication failed' },
    }));
    const cache = createTokenCache({ baseUrl: 'https://api.ebay.test' });

    await expect(cache.get(http, 'client-a', 'bad')).rejects.toBeInstanceOf(EbayAuthError);
    await expect(cache.get(http, 'client-a', 'bad')).rejects.toThrow(
      /client authentication failed/,
    );
  });

  it('does not cache a failure, so fixing the secret works without a restart', async () => {
    let refuse = true;
    const { http, calls } = stubHttp(() =>
      refuse
        ? { status: 401, body: { error_description: 'nope' } }
        : { status: 200, body: { access_token: 'token-good', expires_in: 7200 } },
    );
    const cache = createTokenCache({ baseUrl: 'https://api.ebay.test' });

    await expect(cache.get(http, 'client-a', 'bad')).rejects.toThrow();
    refuse = false;

    await expect(cache.get(http, 'client-a', 'good')).resolves.toBe('token-good');
    expect(calls).toHaveLength(2);
  });

  it('re-authenticates after invalidate, which is what a surprise 401 triggers', async () => {
    const { http, calls } = stubHttp(() => ({
      status: 200,
      body: { access_token: `token-${calls.length}`, expires_in: 7200 },
    }));
    const cache = createTokenCache({ baseUrl: 'https://api.ebay.test' });

    await cache.get(http, 'client-a', 'secret');
    cache.invalidate('client-a');
    await expect(cache.get(http, 'client-a', 'secret')).resolves.toBe('token-2');
  });
});
