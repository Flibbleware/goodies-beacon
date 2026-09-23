import {
  categorySaveSchema,
  createCategory,
  type Database,
  DuplicateCategoryError,
  deleteCategory,
  listCategories,
  updateCategory,
} from '@goodies-beacon/core';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';

export interface CategoryRouteDeps {
  readonly db: Database;
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * `/api/categories` — the owner's categories (P1-22), shared by the wish list and the wanted
 * items. Deleting one leaves whatever used it uncategorised.
 */
export function createCategoryRoutes({ db }: CategoryRouteDeps) {
  const routes = new Hono();

  routes.get('/', async (c) => c.json({ categories: await listCategories(db) }));

  routes.post('/', async (c) => {
    const body = await parseBody(c, categorySaveSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);
    try {
      return c.json({ category: await createCategory(db, body.value) }, 201);
    } catch (error) {
      return duplicateError(c, error);
    }
  });

  routes.put('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return notFound(c);

    const body = await parseBody(c, categorySaveSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);
    try {
      const category = await updateCategory(db, id, body.value);
      return category ? c.json({ category }) : notFound(c);
    } catch (error) {
      return duplicateError(c, error);
    }
  });

  routes.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id) || !(await deleteCategory(db, id))) return notFound(c);
    return c.body(null, 204);
  });

  return routes;
}

function duplicateError(c: Context, error: unknown): Response {
  if (error instanceof DuplicateCategoryError) {
    return errorResponse(c, 409, 'duplicate_category', error.message);
  }
  throw error;
}

function notFound(c: Context): Response {
  return errorResponse(c, 404, 'not_found', 'No such category.');
}
