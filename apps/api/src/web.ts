import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Env, Hono } from 'hono';

/** Resolves to apps/web/dist from both src (tsx) and dist (node), which are equally deep. */
export const WEB_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url));

export function webAppIsBuilt(): boolean {
  return existsSync(WEB_ROOT);
}

/**
 * Serves the built web app, falling back to `index.html` so a deep link like `/settings` is
 * answered by the app rather than a 404 — the router decides what that path means. Mounted last,
 * after `/api` has its own catch-all 404, so no API path can reach the fallback.
 *
 * Not mounted in development, where Vite serves the app and proxies the API here (see
 * `apps/web/vite.config.ts`).
 */
export function serveWebApp<E extends Env>(app: Hono<E>, webRoot: string): void {
  // serveStatic resolves `root` against the working directory, which is not where the files are.
  const root = relative(process.cwd(), webRoot);

  app.use('*', serveStatic<E>({ root }));
  app.get('*', serveStatic<E>({ root, path: 'index.html' }));
}
