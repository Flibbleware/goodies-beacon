import type { Context } from 'hono';
import type { z } from 'zod';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** One place a body is read and validated, so every route reports a bad one the same way. */
export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<ParseResult<z.infer<T>>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, message: 'Expected a JSON body.' };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const [issue] = result.error.issues;
    const field = issue?.path.join('.') ?? 'body';
    return { ok: false, message: `${field} ${issue?.message ?? 'is invalid'}` };
  }

  return { ok: true, value: result.data };
}
