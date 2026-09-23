import {
  createWish,
  type Database,
  deleteWish,
  listWishes,
  promoteWish,
  updateWish,
  wishSaveSchema,
} from '@goodies-beacon/core';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { unknownCategoryError } from '../categories/unknown.js';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';

export interface WishRouteDeps {
  readonly db: Database;
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * `/api/wishes` — the wish list (P1-19). Nothing here touches a marketplace or a model; the one
 * route that leaves the list is `promote`, which hands the wish to the wanted items.
 */
export function createWishRoutes({ db }: WishRouteDeps) {
  const routes = new Hono();

  routes.get('/', async (c) => c.json({ wishes: await listWishes(db) }));

  routes.post('/', async (c) => {
    const body = await parseBody(c, wishSaveSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);
    try {
      return c.json({ wish: await createWish(db, body.value) }, 201);
    } catch (error) {
      return unknownCategoryError(c, error);
    }
  });

  routes.put('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);

    const body = await parseBody(c, wishSaveSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    try {
      const wish = await updateWish(db, id, body.value);
      return wish ? c.json({ wish }) : notFound(c);
    } catch (error) {
      return unknownCategoryError(c, error);
    }
  });

  routes.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id) || !(await deleteWish(db, id))) return notFound(c);
    return c.body(null, 204);
  });

  /** Becomes a draft wanted item, and leaves the list, in one transaction. */
  routes.post('/:id/promote', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);

    const saved = await promoteWish(db, id);
    return saved ? c.json(saved, 201) : notFound(c);
  });

  return routes;
}

// A malformed id is answered as missing rather than reaching Postgres as a type error and a 500.
function notFound(c: Context): Response {
  return errorResponse(c, 404, 'not_found', 'No such wish.');
}
