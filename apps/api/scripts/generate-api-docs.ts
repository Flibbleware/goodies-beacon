/**
 * Writes docs/API.md from Hono's own route table, so the documented surface cannot drift from the
 * mounted one. Not an OpenAPI spec: there is nothing here about bodies or responses yet, and a
 * hand-maintained spec would be wrong within a week.
 *
 *   pnpm docs:api          rewrite docs/API.md
 *   pnpm docs:api --check  fail if it is out of date (CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSilentLogger, type Database } from '@goodies-beacon/core';
import { createApp } from '../src/app.js';

const OUTPUT = fileURLToPath(new URL('../../../docs/API.md', import.meta.url));

/** Routes that answer without a session; everything else under /api is behind the guard. */
const PUBLIC = new Set([
  'GET /healthz',
  'GET /api/auth/session',
  'POST /api/auth/first-run',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Route {
  readonly method: string;
  readonly path: string;
}

function routesOf(): Route[] {
  const app = createApp({
    db: {} as Database,
    logger: createSilentLogger(),
    config: {
      host: 'beacon.example.co.uk',
      secretKey: 'IqQ8Xn1rWQhTsm9gOZ4vKdLpEbYxAcRuNjFkHt2SwVo=',
      version: 'dev',
      sha: 'unknown',
    },
    // No webRoot, so the web app's catch-all does not swamp the table; it is not part of the API.
  });

  const seen = new Set<string>();
  return (
    app.routes
      // Middleware registers itself as ALL on a wildcard; only real handlers are endpoints.
      .filter(({ method, path }) => method !== 'ALL' && !path.endsWith('*'))
      .map(({ method, path }) => ({ method, path }))
      .filter(({ method, path }) => {
        const key = `${method} ${path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  );
}

function render(routes: Route[]): string {
  const rows = routes.map(({ method, path }) => {
    const key = `${method} ${path}`;
    const auth = PUBLIC.has(key) ? 'public' : 'session';
    const csrf = UNSAFE_METHODS.has(method) ? 'required' : '—';
    return `| \`${method}\` | \`${path}\` | ${auth} | ${csrf} |`;
  });

  return `# Goodies Beacon — API

Generated from the route table by \`pnpm docs:api\`. Do not edit by hand.

**Auth** is \`session\` where a valid \`gb_session\` cookie is required — every \`/api\` path that is
not listed as \`public\` answers 401 without one, including paths with no route. **CSRF** is required
on state-changing methods: send the \`gb_csrf\` cookie's value back in \`X-CSRF-Token\` (§12).

Errors always take the shape \`{ error: { code, message } }\`. Every response carries an
\`X-Request-Id\`; quote it when reporting a 500.

| Method | Path | Auth | CSRF |
|---|---|---|---|
${rows.join('\n')}

Anything outside \`/api\` and \`/healthz\` is served by the web app in production, with a fallback to
\`index.html\` so deep links survive a refresh.
`;
}

const generated = render(routesOf());

if (process.argv.includes('--check')) {
  const existing = readFileSync(OUTPUT, 'utf8');
  if (existing !== generated) {
    console.error('docs/API.md is out of date. Run: pnpm docs:api');
    process.exit(1);
  }
  console.log('docs/API.md is up to date.');
} else {
  writeFileSync(OUTPUT, generated);
  console.log(`wrote ${OUTPUT}`);
}
