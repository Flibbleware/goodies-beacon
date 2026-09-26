import {
  createItem,
  type Database,
  ItemNotReadyError,
  itemPatchSchema,
  itemSaveSchema,
  listItems,
  loadItem,
  saveItem,
  UnknownGradingScaleError,
  UnknownImageError,
  updateItem,
} from '@goodies-beacon/core';
import { Hono } from 'hono';
import { unknownCategoryError } from '../categories/unknown.js';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';

export interface ItemRouteDeps {
  readonly db: Database;
}

/**
 * `/api/items` — the manual spec editor's endpoints (P1-13).
 *
 * There is no way to edit a spec in place: a save is `PUT`, and what it does is write version N+1
 * and point the item at it (§4). The interviewer in Phase 3 writes versions through the same
 * store, so the history stays one list whoever proposed the change. `PATCH` changes only the
 * item's own fields, which are not the spec and write no version.
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
      return saveError(c, error);
    }
  });

  routes.get('/:id', async (c) => {
    const item = await loadItem(db, c.req.param('id'));
    if (!item) return errorResponse(c, 404, 'not_found', 'No such wanted item.');
    return c.json({ item });
  });

  /**
   * Pause and resume, rename, recategorise, and the display image (§14, P1-25). Separate from the
   * save because none of them is a spec change: a version in the history every time a query is
   * paused for an evening or an item renamed would make the history answer a question nobody
   * asked of it.
   */
  routes.patch('/:id', async (c) => {
    const body = await parseBody(c, itemPatchSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    try {
      const item = await updateItem(db, c.req.param('id'), body.value);
      if (!item) return errorResponse(c, 404, 'not_found', 'No such wanted item.');
      return c.json({ item });
    } catch (error) {
      return saveError(c, error);
    }
  });

  routes.put('/:id', async (c) => {
    const body = await parseBody(c, itemSaveSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    try {
      const saved = await saveItem(db, c.req.param('id'), body.value);
      if (!saved) return errorResponse(c, 404, 'not_found', 'No such wanted item.');
      return c.json(saved);
    } catch (error) {
      return saveError(c, error);
    }
  });

  return routes;
}

/**
 * A grading scale, category or image that does not exist is the editor's mistake, not the
 * server's; so is asking an item to poll before its spec can (P1-26).
 */
function saveError(c: Parameters<typeof errorResponse>[0], error: unknown): Response {
  if (error instanceof ItemNotReadyError) {
    return errorResponse(c, 400, 'not_ready', error.message);
  }
  if (error instanceof UnknownImageError) {
    return errorResponse(
      c,
      400,
      'unknown_image',
      `displayImageId names no stored image: ${error.mediaId}`,
    );
  }
  if (error instanceof UnknownGradingScaleError) {
    return errorResponse(
      c,
      400,
      'unknown_grading_scale',
      `spec.settings.gradingScaleId names no grading scale: ${error.gradingScaleId}`,
    );
  }
  return unknownCategoryError(c, error);
}
