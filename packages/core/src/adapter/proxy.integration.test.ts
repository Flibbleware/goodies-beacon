import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpClient } from './http.js';

/**
 * The proxy setting is the difference between Vinted working and not working from a VPS (§2, §5),
 * so "we pass the URL to undici" is not enough of an assertion: this runs a real forward proxy in
 * the test and checks the request actually arrived there rather than at the origin.
 *
 * Plain HTTP rather than TLS, because what is under test is whether the dispatcher is applied at
 * all. A CONNECT tunnel would exercise Node's TLS stack instead, and prove less.
 */

let origin: Server;
let proxy: Server;
let originUrl = '';
let proxyUrl = '';
const proxied: string[] = [];
let directHits = 0;

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

beforeAll(async () => {
  origin = createServer((req, res) => {
    directHits += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/address') {
      res.end(JSON.stringify({ ip: '198.51.100.9', country: 'GB' }));
      return;
    }
    res.end(JSON.stringify({ seenBy: 'origin', url: req.url }));
  });
  originUrl = await listen(origin);

  // A forward proxy receives the absolute URL on the request line and fetches it itself. Here it
  // answers directly, so a response tagged `proxy` can only have come through it.
  proxy = createServer((req, res) => {
    proxied.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ seenBy: 'proxy', url: req.url }));
  });
  proxyUrl = await listen(proxy);
});

afterAll(async () => {
  origin.close();
  proxy.close();
});

describe('the HTTP client honours the proxy setting', () => {
  it('sends the request through the proxy when one is configured', async () => {
    const client = createHttpClient({ minDelayMs: 0, maxDelayMs: 0, proxyUrl });

    const response = await client.fetch(`${originUrl}/catalog?page=1`);
    const body = (await response.json()) as { seenBy: string };

    expect(body.seenBy).toBe('proxy');
    expect(proxied.at(-1)).toContain('/catalog?page=1');
    await client.close();
  });

  it('goes straight to the origin when no proxy is configured', async () => {
    const before = directHits;
    const client = createHttpClient({ minDelayMs: 0, maxDelayMs: 0 });

    const response = await client.fetch(`${originUrl}/catalog?page=2`);
    const body = (await response.json()) as { seenBy: string };

    expect(body.seenBy).toBe('origin');
    expect(directHits).toBe(before + 1);
    await client.close();
  });

  it('looks the exit address up through the proxy, which is what the Test button asks', async () => {
    const client = createHttpClient({
      minDelayMs: 0,
      maxDelayMs: 0,
      proxyUrl,
      // Pointed at the local origin rather than the real lookup service: over https the proxy
      // would be a CONNECT tunnel, which this stub does not implement and which would be testing
      // Node's TLS stack rather than whether the dispatcher was applied.
      exitAddressUrl: `${originUrl}/whereami`,
    });

    await expect(client.exitAddress()).rejects.toThrow(/no ip/);
    expect(proxied.at(-1)).toContain('/whereami');
    await client.close();
  });

  it('parses an exit address the lookup does return', async () => {
    const client = createHttpClient({
      minDelayMs: 0,
      maxDelayMs: 0,
      exitAddressUrl: `${originUrl}/address`,
    });

    await expect(client.exitAddress()).resolves.toEqual({ ip: '198.51.100.9', country: 'GB' });
    await client.close();
  });
});
