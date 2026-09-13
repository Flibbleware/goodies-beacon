import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSilentLogger } from '@goodies-beacon/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserFactory } from './browser.js';

/**
 * Needs a real Chromium, which CI installs for the Playwright job but not for the unit tests, so
 * this skips itself when the browser is absent rather than failing a fork's build. Run locally
 * with `pnpm --filter @goodies-beacon/web exec playwright install chromium` already done.
 */
const hasBrowser = await chromiumAvailable();

async function chromiumAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    return Boolean(chromium.executablePath());
  } catch {
    return false;
  }
}

let origin: Server;
let proxy: Server;
let originUrl = '';
let proxyUrl = '';
const proxied: string[] = [];
const originResourceTypes: string[] = [];

const PAGE = `<!doctype html><html><head>
  <link rel="stylesheet" href="/style.css">
</head><body>
  <h1 id="title">Carmageddon big box</h1>
  <img src="/photo.jpg" alt="">
</body></html>`;

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

beforeAll(async () => {
  origin = createServer((req, res) => {
    originResourceTypes.push(req.url ?? '');
    if (req.url === '/photo.jpg') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(Buffer.alloc(16));
      return;
    }
    if (req.url === '/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end('body{color:red}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  originUrl = await listen(origin);

  proxy = createServer((req, res) => {
    proxied.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  proxyUrl = await listen(proxy);
});

afterAll(async () => {
  origin.close();
  proxy.close();
});

describe.skipIf(!hasBrowser)('the browser factory', () => {
  it('renders a page and hands back its HTML', async () => {
    const factory = createBrowserFactory({ logger: createSilentLogger() });
    try {
      const html = await factory.withPage(async (page) => {
        await page.goto(`${originUrl}/listing/1`);
        await page.waitForSelector('#title');
        return page.content();
      });

      expect(html).toContain('Carmageddon big box');
    } finally {
      await factory.close();
    }
  });

  it('blocks images and fonts, which are most of a listing page and none of its content', async () => {
    originResourceTypes.length = 0;
    const factory = createBrowserFactory({ logger: createSilentLogger() });
    try {
      await factory.withPage(async (page) => {
        await page.goto(`${originUrl}/listing/2`);
        await page.waitForSelector('#title');
        return null;
      });

      expect(originResourceTypes).toContain('/listing/2');
      expect(originResourceTypes).not.toContain('/photo.jpg');
      // The stylesheet is not blocked: it is small, and blocking it can change what renders.
      expect(originResourceTypes).toContain('/style.css');
    } finally {
      await factory.close();
    }
  });

  /** The Playwright half of P1-03's "the proxy setting is honoured by both". */
  it('routes the browser through the proxy when one is configured', async () => {
    proxied.length = 0;
    const factory = createBrowserFactory({ logger: createSilentLogger(), proxyUrl });
    try {
      await factory.withPage(async (page) => {
        await page.goto(`${originUrl}/listing/3`);
        return page.content();
      });

      expect(proxied.some((url) => url.includes('/listing/3'))).toBe(true);
    } finally {
      await factory.close();
    }
  });

  it('runs one page at a time even when several callers ask at once', async () => {
    const factory = createBrowserFactory({ logger: createSilentLogger() });
    let inFlight = 0;
    let peak = 0;
    try {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          factory.withPage(async (page) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await page.goto(`${originUrl}/listing/4`);
            inFlight -= 1;
            return null;
          }),
        ),
      );

      expect(peak).toBe(1);
    } finally {
      await factory.close();
    }
  });

  it('keeps working after a page throws, rather than wedging the queue', async () => {
    const factory = createBrowserFactory({ logger: createSilentLogger() });
    try {
      await expect(
        factory.withPage(async () => {
          throw new Error('parse failed');
        }),
      ).rejects.toThrow('parse failed');

      const html = await factory.withPage(async (page) => {
        await page.goto(`${originUrl}/listing/5`);
        return page.content();
      });

      expect(html).toContain('Carmageddon');
    } finally {
      await factory.close();
    }
  });
});
