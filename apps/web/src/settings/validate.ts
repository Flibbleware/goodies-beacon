import type { z } from 'zod';

/**
 * Runs the server's own schema over a section and returns a message per field, so the form says
 * the same thing the API would — the schema in `@goodies-beacon/core/schemas` is the one copy.
 */
export function fieldErrors<T extends z.ZodType>(
  schema: T,
  value: unknown,
  section: string,
): Record<string, string> {
  const result = schema.safeParse(value);
  if (result.success) return {};

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const [head, field] = issue.path;
    if (head !== section || typeof field !== 'string') continue;
    errors[field] ??= issue.message;
  }
  return errors;
}
