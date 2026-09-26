import {
  createSharedCriterion,
  type Database,
  DuplicateSharedCriterionError,
  deleteSharedCriterion,
  listSharedCriteria,
  sharedCriterionCreateSchema,
  sharedCriterionUpdateSchema,
  updateSharedCriterion,
} from '@goodies-beacon/core';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';

export interface SharedCriterionRouteDeps {
  readonly db: Database;
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * `/api/shared-criteria` — criteria written once and used by many wanted items (P1-27). Saving one
 * writes a new version on every item whose copy it changes, and says how many; deleting one leaves
 * each item its copy as a criterion of its own.
 */
export function createSharedCriterionRoutes({ db }: SharedCriterionRouteDeps) {
  const routes = new Hono();

  routes.get('/', async (c) => c.json({ criteria: await listSharedCriteria(db) }));

  routes.post('/', async (c) => {
    const body = await parseBody(c, sharedCriterionCreateSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);
    try {
      return c.json({ criterion: await createSharedCriterion(db, body.value) }, 201);
    } catch (error) {
      if (error instanceof DuplicateSharedCriterionError) {
        return errorResponse(c, 409, 'duplicate_shared_criterion', error.message);
      }
      throw error;
    }
  });

  routes.put('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);

    const body = await parseBody(c, sharedCriterionUpdateSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);
    const updated = await updateSharedCriterion(db, id, body.value);
    return updated ? c.json(updated) : notFound(c);
  });

  routes.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id) || !(await deleteSharedCriterion(db, id))) return notFound(c);
    return c.body(null, 204);
  });

  return routes;
}

function notFound(c: Context): Response {
  return errorResponse(c, 404, 'not_found', 'No such shared criterion.');
}
