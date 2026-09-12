import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'packages/sources/*', 'apps/*'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-types/**'],
    passWithNoTests: true,
    // The integration tests share one TEST_DATABASE_URL and each clears the tables it uses, so
    // two files running at once would pull the rows out from under each other.
    fileParallelism: false,
  },
});
