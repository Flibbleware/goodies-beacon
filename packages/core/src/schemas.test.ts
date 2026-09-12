import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as schemas from './schemas.js';

/** Node-only packages the web app cannot bundle; reaching any of them breaks its build. */
const FORBIDDEN = ['pg', 'pg-boss', 'pino', 'drizzle-orm', '@node-rs/argon2'];

const ENTRY = fileURLToPath(new URL('./schemas.ts', import.meta.url));

describe('@goodies-beacon/core/schemas', () => {
  it('exports the schemas the web app validates against', () => {
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'settingsSchema',
        'settingsPatchSchema',
        'toPublicSettings',
        'isEmailConfigured',
        'changePasswordSchema',
        'passwordSchema',
      ]),
    );
  });

  /**
   * The reason this entry point exists. The package root reaches Postgres, pg-boss, pino and the
   * native argon2 binding; if this one ever does, `pnpm build` fails in apps/web with something
   * far less obvious than a failing test here.
   */
  it('reaches nothing that cannot run in a browser', () => {
    expect(packagesReachedFrom(ENTRY).filter((name) => isForbidden(name))).toEqual([]);
  });

  it('and the check would notice if it did', () => {
    const root = fileURLToPath(new URL('./index.ts', import.meta.url));
    expect(packagesReachedFrom(root).filter((name) => isForbidden(name))).not.toEqual([]);
  });
});

function isForbidden(specifier: string): boolean {
  return FORBIDDEN.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/** Every bare specifier reachable from `entry` by following relative imports. */
function packagesReachedFrom(entry: string): string[] {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) {
        packages.add(specifier);
        continue;
      }
      // TypeScript writes NodeNext imports with the .js extension the output will have.
      queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
    }
  }

  return [...packages];
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/(?:^|\n)(?:import|export)[^'"\n]*from\s*'([^']+)'/g)].map(
    ([, specifier]) => specifier as string,
  );
}
