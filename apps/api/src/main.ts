import { loadConfigOrExit, runMigrations } from '@goodies-beacon/core';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const config = loadConfigOrExit();

// P0-06 moves this to the shared ROLE-aware entrypoint; until then the API container is the
// one that migrates, and the advisory lock inside runMigrations makes a second one harmless.
if (config.role === 'api' || config.role === 'all') {
  try {
    await runMigrations(config.databaseUrl);
  } catch (error) {
    console.error(`Database migration failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

const app = createApp();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`goodies-beacon api listening on http://localhost:${info.port}`);
});
