import { describe, expect, it } from 'vitest';
import { createLogger, createSilentLogger } from './logger.js';

/** Collects the JSON lines pino writes, so the adapter can be checked rather than guessed at. */
function collector(): { lines: Record<string, unknown>[]; write(line: string): void } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    write(line) {
      lines.push(JSON.parse(line));
    },
  };
}

describe('createLogger', () => {
  it('writes the message and its fields onto one json line', () => {
    const out = collector();

    createLogger('info', out).info('api listening', { port: 3000 });

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({ msg: 'api listening', port: 3000, level: 30 });
  });

  it('drops lines below the configured level', () => {
    const out = collector();
    const logger = createLogger('info', out);

    logger.debug('noisy');
    logger.info('kept');
    logger.warn('kept');
    logger.error('kept');

    expect(out.lines.map((line) => line.msg)).toEqual(['kept', 'kept', 'kept']);
  });

  it('says nothing at all when LOG_LEVEL is silent', () => {
    const out = collector();

    createLogger('silent', out).error('broken');

    expect(out.lines).toEqual([]);
  });

  it('stamps a child logger onto every line it writes', () => {
    const out = collector();
    const request = createLogger('info', out).child({ requestId: 'req-1' });

    request.info('request', { status: 200 });

    expect(out.lines[0]).toMatchObject({ requestId: 'req-1', status: 200, msg: 'request' });
  });

  it('keeps the parent unstamped, so a child cannot leak its fields sideways', () => {
    const out = collector();
    const logger = createLogger('info', out);

    logger.child({ requestId: 'req-1' }).info('in the request');
    logger.info('outside the request');

    expect(out.lines[1]).not.toHaveProperty('requestId');
  });

  it('leaves out pid and hostname, which say nothing about a single container', () => {
    const out = collector();

    createLogger('info', out).info('started');

    expect(out.lines[0]).not.toHaveProperty('pid');
    expect(out.lines[0]).not.toHaveProperty('hostname');
  });
});

describe('createSilentLogger', () => {
  it('accepts every call, including on a child, and writes nothing', () => {
    const logger = createSilentLogger();

    expect(() => {
      logger.error('a');
      logger.warn('b');
      logger.info('c');
      logger.debug('d');
      logger.child({ requestId: 'x' }).info('e');
    }).not.toThrow();
  });
});
