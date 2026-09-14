#!/usr/bin/env node
/**
 * Fails the image build when a workspace package is linked but has no build output.
 *
 * The runtime stage starts from a production install, which creates a `node_modules` symlink for
 * every workspace package the entrypoint depends on, and then copies each package's `dist` in by
 * hand. Miss one and the link still resolves, the image builds, and the container dies on start
 * with `ERR_MODULE_NOT_FOUND` — which is only caught by CI's slowest job, and then only because
 * it tries to start the thing.
 *
 * That has happened twice: P1-04 added the eBay adapter to apps/api for the Settings Test button,
 * and P1-08 added the AI package for the same reason. A comment in the Dockerfile asking the next
 * person to remember did not prevent the second one, so this asserts it instead.
 *
 * Run from the image's working directory, after the dist copies and before it is tagged.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCOPE = '@goodies-beacon';

/** Where a linked package's entry point should be, according to its own manifest. */
function entryPoint(packageDir) {
  const manifest = join(packageDir, 'package.json');
  if (!existsSync(manifest)) return undefined;

  const { main, exports } = JSON.parse(readFileSync(manifest, 'utf8'));
  const fromExports = typeof exports?.['.'] === 'object' ? exports['.'].default : undefined;
  const entry = main ?? fromExports;
  return typeof entry === 'string' ? resolve(packageDir, entry) : undefined;
}

/** Every `<somewhere>/node_modules/@goodies-beacon` directory in the tree, without walking into
 *  the pnpm virtual store, which holds the same packages again under hashed names. */
function scopeDirs(root) {
  const found = [];

  for (const base of ['.', 'apps', 'packages', 'packages/sources']) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir)) {
      const candidate = join(dir, entry, 'node_modules', SCOPE);
      if (existsSync(candidate)) found.push(candidate);
    }

    const direct = join(dir, 'node_modules', SCOPE);
    if (existsSync(direct)) found.push(direct);
  }

  return found;
}

const root = process.argv[2] ?? process.cwd();
const missing = new Map();

for (const dir of scopeDirs(root)) {
  for (const name of readdirSync(dir)) {
    const link = join(dir, name);
    if (!statSync(link).isDirectory()) continue;

    const target = realpathSync(link);
    const entry = entryPoint(target);
    // A package with no declared entry point has nothing to check; one that declares a file it
    // has not got is the failure this exists for.
    if (entry && !existsSync(entry)) {
      missing.set(`${SCOPE}/${name}`, entry.replace(`${root}/`, ''));
    }
  }
}

if (missing.size > 0) {
  console.error('These workspace packages are linked but have no build output in the image:\n');
  for (const [name, entry] of missing) console.error(`  ${name}  (expected ${entry})`);
  console.error(
    '\nAdd a COPY line for each to the runtime stage of the Dockerfile, beside the others:\n' +
      '  COPY --from=build /app/packages/<name>/dist packages/<name>/dist\n',
  );
  process.exit(1);
}

console.log(`workspace build output present for every linked ${SCOPE} package`);
