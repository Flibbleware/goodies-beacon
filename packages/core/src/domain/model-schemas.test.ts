import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MODEL_OUTPUT_SCHEMAS } from './verdict.js';

/**
 * Every schema handed to a model must stay inside the subset all the providers accept.
 *
 * This exists because of a real failure: `reason` and three of the reviewer's four fields carried
 * a `.default()`, which makes them optional, which leaves them out of the JSON Schema's `required`
 * list. Gemini accepted that without complaint. OpenAI refused every single call —
 * *"'required' is required to be supplied and to be an array including every key in properties"* —
 * so the pre-filter could not run at all on the provider the roles default to, and P1-10's
 * reviewer would have hit the same wall with three times as many fields.
 *
 * §9's promise is that switching providers is a Settings change. A schema that works on one and
 * fails on another breaks that promise quietly, in a place no unit test was looking.
 */

/** Walks nested objects too: strict mode applies at every level, not just the root. */
function objectsIn(
  schema: Record<string, unknown>,
  path = 'root',
): [string, Record<string, unknown>][] {
  const found: [string, Record<string, unknown>][] = [];

  if (schema.type === 'object' && schema.properties) {
    found.push([path, schema]);
    for (const [name, child] of Object.entries(schema.properties as Record<string, never>)) {
      found.push(...objectsIn(child, `${path}.${name}`));
    }
  }
  if (schema.type === 'array' && schema.items) {
    found.push(...objectsIn(schema.items as Record<string, unknown>, `${path}[]`));
  }

  return found;
}

describe.each(Object.entries(MODEL_OUTPUT_SCHEMAS))('the %s output schema', (name, schema) => {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;

  it('names every property as required, at every level', () => {
    for (const [path, object] of objectsIn(json)) {
      const properties = Object.keys(object.properties as object);
      const required = (object.required as string[]) ?? [];

      expect(
        properties.filter((property) => !required.includes(property)),
        `${name} at ${path}: optional properties are rejected by OpenAI. Use .nullable() rather than .default()`,
      ).toEqual([]);
    }
  });

  /** A model cannot be asked for a value it was never told about. */
  it('declares at least one property', () => {
    expect(Object.keys(json.properties as object).length).toBeGreaterThan(0);
  });
});
