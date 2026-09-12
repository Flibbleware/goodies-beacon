import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './logger.js';
import { createShutdown } from './shutdown.js';

const logger: Logger = { error() {}, warn() {}, info() {}, debug() {} };

function harness(timeoutMs?: number) {
  const exit = vi.fn<(code: number) => void>();
  const shutdown = createShutdown(
    timeoutMs === undefined ? { logger, exit } : { logger, exit, timeoutMs },
  );
  return { exit, shutdown };
}

describe('createShutdown', () => {
  it('lets an in-flight step finish and exits 0', async () => {
    const { exit, shutdown } = harness();
    let finished = false;

    shutdown.add('slow job', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
    });
    await shutdown.run('SIGTERM');

    expect(finished).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('closes in reverse registration order, so a resource outlives what it depends on', async () => {
    const { shutdown } = harness();
    const closed: string[] = [];

    for (const name of ['pool', 'queues', 'server']) {
      shutdown.add(name, async () => {
        closed.push(name);
      });
    }
    await shutdown.run('SIGTERM');

    expect(closed).toEqual(['server', 'queues', 'pool']);
  });

  it('runs the remaining steps when one fails, then exits non-zero', async () => {
    const { exit, shutdown } = harness();
    const closed: string[] = [];

    shutdown.add('pool', async () => {
      closed.push('pool');
    });
    shutdown.add('queues', () => Promise.reject(new Error('boom')));
    await shutdown.run('SIGTERM');

    expect(closed).toEqual(['pool']);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('is idempotent, so a second signal joins the shutdown already running', async () => {
    const { exit, shutdown } = harness();
    const step = vi.fn(async () => {});

    shutdown.add('queues', step);
    await Promise.all([shutdown.run('SIGTERM'), shutdown.run('SIGINT')]);

    expect(step).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('gives up on a step that outlasts the timeout rather than hanging forever', async () => {
    const { exit, shutdown } = harness(10);
    let released: (() => void) | undefined;

    shutdown.add('stuck', () => new Promise<void>((resolve) => (released = resolve)));
    const running = shutdown.run('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    released?.();
    await running;
  });
});
