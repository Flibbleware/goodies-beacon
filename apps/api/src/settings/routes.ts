import {
  type Database,
  readSettings,
  settingsPatchSchema,
  writeSettings,
} from '@goodies-beacon/core';
import { Hono } from 'hono';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';

export interface SettingsRouteDeps {
  readonly db: Database;
  /** Shown read-only: it comes from the environment, not from settings (§P0-10). */
  readonly host: string;
}

/**
 * `/api/settings`, behind the session guard. The instance section is all there is for now; P0-10
 * adds email and the account password change, and later tasks the rest of §14's list.
 */
export function createSettingsRoutes({ db, host }: SettingsRouteDeps) {
  const routes = new Hono();

  routes.get('/', async (c) => c.json({ settings: await readSettings(db), instanceHost: host }));

  routes.put('/', async (c) => {
    const body = await parseBody(c, settingsPatchSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    return c.json({ settings: await writeSettings(db, body.value), instanceHost: host });
  });

  return routes;
}
