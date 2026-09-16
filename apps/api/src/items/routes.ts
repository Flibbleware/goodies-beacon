import {
  createItem,
  type Database,
  itemSaveSchema,
  itemStatusSchema,
  listItems,
  loadItem,
  saveItem,
  setItemStatus,
  UnknownGradingScaleError,
} from '@goodies-beacon/core';
import { Hono } from 'hono';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';

export interface ItemRouteDeps {
  readonly db: Database;
}

/**
 * `/api/items` — the manual spec editor's endpoints (P1-13).
 *
 * There is no PATCH and no way to edit a spec in place: a save is `PUT`, and what it does is
 * write version N+1 and point the item at it (§4). The interviewer in Phase 3 writes versions
 * through the same store, so the history stays one list whoever proposed the change.
 */
export function createItemRoutes({ db }: ItemRouteDeps) {
  const routes = new Hono();

  routes.get('/', async (c) => c.json({ items: await listItems(db) }));

  routes.post('/', async (c) => {
    const body = await parseBody(c, itemSaveSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    try {
      const saved = await createItem(db, body.value);
      return c.json(saved, 201);
    } catch (error) {
      return gradingScaleError(c, error);
    }
  });

  routes.get('/:id', async (c) => {
    const item = await loadItem(db, c.req.param('id'));
    if (!item) return errorResponse(c, 404, 'not_found', 'No such wanted item.');
    return c.json({ item });
  });

  /**
   * Pause and resume (§14). Separate from the save because it is not a spec change: putting a
   * version in the history every time a query is paused for an evening would make the history
   * answer a question nobody asked of it.
   */
  routes.patch('/:id', async (c) => {
    const body = await parseBody(c, itemStatusSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    const status = await setItemStatus(db, c.req.param('id'), body.value.status);
    if (!status) return errorResponse(c, 404, 'not_found', 'No such wanted item.');
    return c.json({ status });
  });

  routes.put('/:id', async (c) => {
    const body = await parseBody(c, itemSaveSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    try {
      const saved = await saveItem(db, c.req.param('id'), body.value);
      if (!saved) return errorResponse(c, 404, 'not_found', 'No such wanted item.');
      return c.json(saved);
    } catch (error) {
      return gradingScaleError(c, error);
    }
  });

  return routes;
}

/** A grading scale that does not exist is the editor's mistake, not the server's. */
function gradingScaleError(c: Parameters<typeof errorResponse>[0], error: unknown): Response {
  if (error instanceof UnknownGradingScaleError) {
    return errorResponse(
      c,
      400,
      'unknown_grading_scale',
      `spec.settings.gradingScaleId names no grading scale: ${error.gradingScaleId}`,
    );
  }
  throw error;
}
