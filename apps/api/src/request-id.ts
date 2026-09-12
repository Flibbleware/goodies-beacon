import { randomUUID } from 'node:crypto';
import type { Logger } from '@goodies-beacon/core';
import type { Context, MiddlewareHandler } from 'hono';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestVariables {
  requestId: string;
  logger: Logger;
}

/**
 * Gives every request an id, echoes it back so a caller can quote it, and puts a logger carrying
 * it on the context — so a line logged anywhere in a request can be tied to the request that
 * produced it, and to the one line summarising how it ended.
 *
 * An inbound `x-request-id` is trusted: only Caddy is published (§12), and being able to correlate
 * a proxy log with an application log is worth more than refusing a header a client could forge.
 */
export function requestId(logger: Logger): MiddlewareHandler<{ Variables: RequestVariables }> {
  return async (c, next) => {
    const id = c.req.header(REQUEST_ID_HEADER) ?? randomUUID();
    c.set('requestId', id);
    c.set('logger', logger.child({ requestId: id }));
    c.header(REQUEST_ID_HEADER, id);

    const startedAt = performance.now();
    await next();

    c.get('logger').info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  };
}

/** The id of the request in hand. Falls back to a placeholder outside the middleware's reach. */
export function requestIdOf(c: Context): string {
  return c.get('requestId') ?? 'unknown';
}
