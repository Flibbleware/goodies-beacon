import { UnknownCategoryError } from '@goodies-beacon/core';
import type { Context } from 'hono';
import { errorResponse } from '../errors.js';

/** A wish or an item naming a category that does not exist is the form's mistake (P1-22). */
export function unknownCategoryError(c: Context, error: unknown): Response {
  if (error instanceof UnknownCategoryError) {
    return errorResponse(
      c,
      400,
      'unknown_category',
      `categoryId names no category: ${error.categoryId}`,
    );
  }
  throw error;
}
