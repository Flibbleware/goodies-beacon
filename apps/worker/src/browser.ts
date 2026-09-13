import type { BrowserFactory, BrowserPage, Logger } from '@goodies-beacon/core';
import { type Browser, chromium } from 'playwright';

/**
 * The Playwright half of the adapter context (§5).
 *
 * It lives in the worker rather than in `packages/core` so that core — and the slim image, and
 * an API-only deployment — never depend on a browser. Core declares `BrowserFactory` and
 * `BrowserPage`; Playwright's own `Page` satisfies the latter structurally.
 *
 * One browser at a time, closed after each poll: a headless Chromium costs 300–500 MB while it
 * runs and the droplet has 2 GB (§11). Images and fonts are blocked because the adapters that
 * need a browser need the HTML, and a listing page of photographs is most of its weight.
 */

export interface BrowserFactoryOptions {
  logger: Logger;
  /** Applied to the browser as well as to the HTTP client, so both leave by the same address. */
  proxyUrl?: string | undefined;
  /** Closed and relaunched if a page takes longer than this, so a hung poll cannot pin memory. */
  navigationTimeoutMs?: number;
  headless?: boolean;
}

const BLOCKED_RESOURCES = new Set(['image', 'font', 'media']);

export function createBrowserFactory(options: BrowserFactoryOptions): BrowserFactory & {
  close(): Promise<void>;
} {
  const { logger, proxyUrl } = options;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;

  let browser: Browser | null = null;
  /** Serialises callers, so "one browser at a time" holds even if two plans poll at once. */
  let queue: Promise<unknown> = Promise.resolve();

  const launch = async (): Promise<Browser> => {
    if (browser?.isConnected()) return browser;
    browser = await chromium.launch({
      headless: options.headless ?? true,
      ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
    });
    logger.debug('browser launched', { proxied: Boolean(proxyUrl) });
    return browser;
  };

  const run = async <T>(work: (page: BrowserPage) => Promise<T>): Promise<T> => {
    const instance = await launch();
    const context = await instance.newContext();
    try {
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        return BLOCKED_RESOURCES.has(type) ? route.abort() : route.continue();
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(navigationTimeoutMs);
      return await work(page as BrowserPage);
    } finally {
      await context.close();
    }
  };

  return {
    withPage(work) {
      // Chained rather than locked: each caller waits for the one before, and a failure in one
      // does not leave the chain broken for the next.
      const result = queue.then(
        () => run(work),
        () => run(work),
      );
      queue = result.catch(() => undefined);
      return result;
    },

    async close() {
      await queue.catch(() => undefined);
      await browser?.close();
      browser = null;
      logger.debug('browser closed');
    },
  };
}
