import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** The error shape every route answers with (§P0-08); P0-08 adds the unhandled-error handler. */
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
