import { defineConfig, devices } from '@playwright/test';

/**
 * Drives the real thing: the built web app served by the built API, against a real Postgres, as
 * the production container does it. `E2E_DATABASE_URL` (or `TEST_DATABASE_URL`) names a throwaway
 * database; without one the suite has nothing to run against and says so.
 */
const PORT = Number(process.env.E2E_PORT ?? 4180);
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? '';

/**
 * Point `E2E_BASE_URL` at an instance that is already running — the container, or the droplet
 * during a deploy rehearsal — and Playwright drives that instead of starting its own server. It
 * must be backed by the same throwaway database, because the run resets the password.
 */
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  // `.e2e.ts` rather than the usual `.spec.ts`: vitest's projects are globbed per directory and
  // do not inherit the root `exclude`, so a `.spec.ts` here is collected by `pnpm test` too and
  // fails there. The name keeps the two runners out of each other's way.
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/global-setup.ts',
  // The smoke test owns the instance's single password, so nothing may run beside it.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  ...(external
    ? {}
    : {
        webServer: {
          // `ROLE=api` so the poll and heartbeat workers stay out of the way; NODE_ENV=production is
          // what makes the API serve the built web app, which is the thing under test.
          command: 'node ../api/dist/main.js',
          url: `http://localhost:${PORT}/healthz`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          env: {
            NODE_ENV: 'production',
            ROLE: 'api',
            PORT: String(PORT),
            DATABASE_URL: databaseUrl,
            GOODIES_BEACON_HOST: `localhost:${PORT}`,
            // Only the settings encryption uses this, and the smoke test stores no secrets.
            GOODIES_BEACON_SECRET_KEY: 'IqQ8Xn1rWQhTsm9gOZ4vKdLpEbYxAcRuNjFkHt2SwVo=',
            GOODIES_BEACON_VERSION: 'e2e',
            GOODIES_BEACON_SHA: 'e2e',
            LOG_LEVEL: 'warn',
          },
        },
      }),
});
