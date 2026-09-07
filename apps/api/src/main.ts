import { loadConfigOrExit } from '@goodies-beacon/core';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const config = loadConfigOrExit();
const app = createApp();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`goodies-beacon api listening on http://localhost:${info.port}`);
});
