import {
  createBoss,
  createConsoleLogger,
  createDb,
  createPool,
  createShutdown,
  loadConfigOrExit,
  registerQueues,
  runMigrations,
} from '@goodies-beacon/core';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { processRegistrations, servesApi } from './roles.js';

/**
 * The one entrypoint for every role (§3: one image, `ROLE=api|worker|all`). It lives in apps/api
 * because that is what the image runs; the worker subscribers come from apps/worker.
 */
const config = loadConfigOrExit();
const logger = createConsoleLogger(config.logLevel);
const shutdown = createShutdown({ logger });

try {
  if (servesApi(config.role)) await runMigrations(config.databaseUrl);

  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  shutdown.add('database pool', () => pool.end());

  const boss = createBoss(config, logger);
  // Registered before start() so a failure while subscribing still shuts the queues down.
  shutdown.add('job queues', () => boss.stop({ graceful: true }));
  await boss.start();
  await registerQueues(boss, await processRegistrations({ config, db, logger }), logger);

  if (servesApi(config.role)) {
    const server = serve({ fetch: createApp().fetch, port: config.port }, (info) => {
      logger.info('api listening', { port: info.port });
    });
    // Closed first, so requests stop arriving before the jobs they enqueued are drained.
    shutdown.add(
      'http server',
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
  }

  shutdown.listen();
  logger.info('goodies-beacon started', { role: config.role });
} catch (error) {
  logger.error('startup failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
