import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'packages/sources/*', 'apps/*'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-types/**'],
    passWithNoTests: true,
  },
});
