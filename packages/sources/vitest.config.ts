import { defineConfig } from 'vitest/config';

/**
 * `packages/sources` is a folder of adapter packages, not a package itself — but the root's
 * `packages/*` glob matches it, so vitest roots a project here and finds every adapter's tests
 * nested underneath, running all of them a second time.
 *
 * This config is what stops that: the project still exists, and has nothing to run.
 */
export default defineConfig({ test: { include: [] } });
