import type { Database, Logger } from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { REQUEST_ID_HEADER } from './request-id.js';

interface Line {
  message: string;
  fields: Record<string, unknown> | undefined;
}

/** A logger that records what it was told, including through `child`. */
function recorder(): { lines: Line[]; logger: Logger } {
  const lines: Line[] = [];
  const make = (bound: Record<string, unknown>): Logger => {
    const push = (message: string, fields?: Record<string, unknown>) => {
      lines.push({ message, fields: { ...bound, ...fields } });
    };
    return {
      error: push,
      warn: push,
      info: push,
      debug: push,
      child: (fields) => make({ ...bound, ...fields }),
    };
  };
  return { lines, logger: make({}) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function appWith(logger: Logger, db: Database = workingDb()) {
  return createApp({ db, logger, host: 'beacon.example.co.uk', version: 'dev', sha: 'unknown' });
}

function workingDb(): Database {
  return { execute: async () => [] } as unknown as Database;
}

/** Every query fails, which is what an unhandled error in a route actually looks like. */
function brokenDb(message: string): Database {
  const fail = () => {
    throw new Error(message);
  };
  return {
    execute: fail,
    select: fail,
    insert: fail,
    update: fail,
    delete: fail,
  } as unknown as Database;
}

describe('request ids', () => {
  it('gives every request an id and echoes it back', async () => {
    const { logger } = recorder();
    const res = await appWith(logger).request('/healthz');

    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
  });

  it('gives two requests different ids', async () => {
    const { logger } = recorder();
    const app = appWith(logger);

    const first = await app.request('/healthz');
    const second = await app.request('/healthz');

    expect(first.headers.get(REQUEST_ID_HEADER)).not.toBe(second.headers.get(REQUEST_ID_HEADER));
  });

  it("keeps the caller's id, so a proxy log and an app log can be lined up", async () => {
    const { logger } = recorder();
    const res = await appWith(logger).request('/healthz', {
      headers: { [REQUEST_ID_HEADER]: 'from-caddy-1234' },
    });

    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('from-caddy-1234');
  });

  it('logs one line per request, stamped with its id', async () => {
    const { lines, logger } = recorder();
    await appWith(logger).request('/healthz', {
      headers: { [REQUEST_ID_HEADER]: 'req-1' },
    });

    const request = lines.find(({ message }) => message === 'request');
    expect(request?.fields).toMatchObject({
      requestId: 'req-1',
      method: 'GET',
      path: '/healthz',
      status: 200,
    });
    expect(request?.fields?.durationMs).toBeTypeOf('number');
  });
});

describe('unhandled errors', () => {
  const boom = () => brokenDb('relation "settings" does not exist');

  it('answers a generic 500 with the request id and no stack trace', async () => {
    const { logger } = recorder();
    // The guard's session lookup is the first thing to touch the database, so it throws first.
    const res = await appWith(logger, boom()).request('/api/settings', {
      headers: { [REQUEST_ID_HEADER]: 'req-500', cookie: 'gb_session=anything' },
    });
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: 'internal',
        message: 'Something went wrong. Quote request id req-500 when reporting it.',
      },
    });
    expect(body).not.toContain('relation');
    expect(body).not.toContain('at ');
  });

  it('logs the error and its stack against the request id', async () => {
    const { lines, logger } = recorder();
    await appWith(logger, boom()).request('/api/settings', {
      headers: { [REQUEST_ID_HEADER]: 'req-500', cookie: 'gb_session=anything' },
    });

    const logged = lines.find(({ message }) => message === 'unhandled error');
    expect(logged?.fields).toMatchObject({ requestId: 'req-500' });

    const err = logged?.fields?.err as { message: string; stack: string };
    expect(err.message).toBe('relation "settings" does not exist');
    expect(err.stack).toContain('Error:');
  });

  it('still logs the request line, so a 500 is visible in the access log too', async () => {
    const { lines, logger } = recorder();
    await appWith(logger, boom()).request('/api/settings', {
      headers: { cookie: 'gb_session=anything' },
    });

    expect(lines.find(({ message }) => message === 'request')?.fields).toMatchObject({
      status: 500,
    });
  });
});

describe('unknown endpoints', () => {
  it('answers the API error shape rather than a page', async () => {
    const { logger } = recorder();
    const res = await appWith(logger).request('/api/nope');

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('answers not_found outside /api when no web app is served', async () => {
    const { logger } = recorder();
    const res = await appWith(logger).request('/settings');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: 'No such endpoint.' },
    });
  });
});
