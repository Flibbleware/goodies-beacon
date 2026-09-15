import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Listed rather than globbed with `packages/*`, which also matches `packages/sources` — a
     * plain directory, not a package. Vitest made a project of it, found the adapters' tests
     * nested underneath and ran all 64 of them a second time. A negation does not help: excluding
     * `packages/sources` takes the real adapter projects with it.
     *
     * `packages/core/src/projects.test.ts` fails if a package with tests is missing from this
     * list, so adding one cannot silently stop its tests running.
     */
    projects: ['packages/*', 'packages/sources/*', 'apps/*'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-types/**'],
    passWithNoTests: true,
    // The integration tests share one TEST_DATABASE_URL and each clears the tables it uses, so
    // two files running at once would pull the rows out from under each other.
    fileParallelism: false,
  },
});
