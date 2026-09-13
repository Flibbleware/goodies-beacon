import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

/**
 * Browser-side hardening for every response, the page included (§12). The built web app loads
 * its script and stylesheet from `/assets` on the same origin and has nothing inline, so the
 * policy is plain `'self'`; `data:` images are for the inline SVG the UI may use. Listing photos
 * and reference images arrive in Phase 1 through `/api/media`, which is the same origin too.
 *
 * HSTS is harmless where it does not apply — browsers ignore it over plain HTTP — and a `.app`
 * name is preloaded anyway, so it is set unconditionally.
 */
export function securityHeaders(): MiddlewareHandler {
  return secureHeaders({
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      imgSrc: ["'self'", 'data:'],
    },
    referrerPolicy: 'strict-origin-when-cross-origin',
  });
}
