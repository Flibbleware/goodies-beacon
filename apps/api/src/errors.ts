import type { Logger } from '@goodies-beacon/core';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { requestIdOf } from './request-id.js';

/** The shape every error answer takes, whatever went wrong. */
export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
): Response {
  return c.json<ErrorBody>({ error: { code, message } }, status);
}

export function notFoundHandler(): NotFoundHandler {
  return (c) => errorResponse(c, 404, 'not_found', 'No such endpoint.');
}

/**
 * The last line for anything a route did not handle. The error and its stack go to the log with
 * the request id; the caller gets that id and nothing else, because a stack trace tells an
 * attacker about paths, dependencies and versions.
 */
export function errorHandler(logger: Logger): ErrorHandler {
  return (error, c) => {
    if (error instanceof HTTPException) return error.getResponse();

    const requestId = requestIdOf(c);
    logger.error('unhandled error', {
      requestId,
      err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    });

    return errorResponse(
      c,
      500,
      'internal',
      `Something went wrong. Quote request id ${requestId} when reporting it.`,
    );
  };
}
