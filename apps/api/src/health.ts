import { type Database, pingDatabase } from '@goodies-beacon/core';
import { Hono } from 'hono';

export interface HealthDeps {
  readonly db: Database;
  readonly version: string;
  readonly sha: string;
}

export interface HealthBody {
  readonly status: 'ok' | 'error';
  readonly version: string;
  readonly sha: string;
  readonly db: 'ok' | 'unreachable';
}

/**
 * `/healthz`. Outside `/api` and outside the session guard, because the deploy script and any
 * monitor have to reach it. It answers 503 rather than 200 with a warning so those callers can
 * act on the status code alone.
 */
export function createHealthRoute({ db, version, sha }: HealthDeps) {
  const route = new Hono();

  route.get('/', async (c) => {
    const reachable = await pingDatabase(db);
    const body: HealthBody = {
      status: reachable ? 'ok' : 'error',
      version,
      sha,
      db: reachable ? 'ok' : 'unreachable',
    };
    return c.json(body, reachable ? 200 : 503);
  });

  return route;
}
