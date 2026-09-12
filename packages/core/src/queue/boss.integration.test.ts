import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../config.js';
import { createDb, createPool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { processHeartbeat } from '../db/schema.js';
import { createSilentLogger } from '../logger.js';
import { createShutdown } from '../shutdown.js';
import { createBoss } from './boss.js';
import { heartbeatRegistration, recordHeartbeat } from './heartbeat.js';
import { heartbeatQueueName } from './names.js';
import { registerQueues } from './registry.js';

/**
 * Driven by TEST_DATABASE_URL like migrate's tests. They are the only proof that a job in flight
 * survives a shutdown, which no fake of pg-boss could demonstrate.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const logger = createSilentLogger();

const config = databaseUrl
  ? parseConfig({
      DATABASE_URL: databaseUrl,
      GOODIES_BEACON_HOST: 'beacon.test',
      GOODIES_BEACON_SECRET_KEY: randomBytes(32).toString('base64'),
      ROLE: 'worker',
    })
  : undefined;

const closers: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => {});
});

describe.skipIf(!config)('pg-boss wiring against a real Postgres', () => {
  it('creates every registered queue and records the heartbeat for its role', async () => {
    const current = config as NonNullable<typeof config>;
    await runMigrations(current.databaseUrl);

    const pool = createPool(current.databaseUrl);
    closers.push(() => pool.end());
    const db = createDb(pool);

    const boss = createBoss(current, logger);
    closers.push(() => boss.stop({ graceful: false }));
    await boss.start();
    await registerQueues(boss, [heartbeatRegistration(db, 'worker', logger)], logger);

    expect(await boss.getQueue(heartbeatQueueName('worker'))).not.toBeNull();
    expect(await boss.getSchedule(heartbeatQueueName('worker'))).not.toBeNull();

    await recordHeartbeat(db, 'worker');
    const [row] = await db
      .select()
      .from(processHeartbeat)
      .where(eq(processHeartbeat.role, 'worker'));
    expect(row?.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('lets a job that is already running finish before the process exits 0', async () => {
    const current = config as NonNullable<typeof config>;
    const queue = `test.graceful.${randomUUID()}`;
    const exit = vi.fn<(code: number) => void>();
    let started = false;
    let finished = false;

    const boss = createBoss(current, logger);
    closers.push(() => boss.deleteQueue(queue));
    await boss.start();

    const shutdown = createShutdown({ logger, exit });
    shutdown.add('job queues', () => boss.stop({ graceful: true }));

    await registerQueues(
      boss,
      [
        {
          name: queue,
          workOptions: { pollingIntervalSeconds: 0.5 },
          handler: async () => {
            started = true;
            await new Promise((resolve) => setTimeout(resolve, 750));
            finished = true;
          },
        },
      ],
      logger,
    );
    await boss.send(queue, {});
    await vi.waitFor(() => expect(started).toBe(true), { timeout: 15_000, interval: 50 });

    await shutdown.run('SIGTERM');

    expect(finished).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  }, 30_000);
});
