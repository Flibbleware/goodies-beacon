import type { Category, CategorySaveInput } from '@goodies-beacon/core/schemas';
import type { QueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import { itemsQuery } from './items.js';
import { wishesQuery } from './wishes.js';

/** JSON carries timestamps as ISO strings, so those two are restated (see items.ts). */
export type CategoryRow = Omit<Category, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export type CategorySave = CategorySaveInput;

export const categoriesQuery = {
  queryKey: ['categories'] as const,
  queryFn: () => api<{ categories: CategoryRow[] }>('/api/categories'),
} as const;

export function createCategory(body: CategorySave): Promise<{ category: CategoryRow }> {
  return api('/api/categories', { method: 'POST', body });
}

export function updateCategory(id: string, body: CategorySave): Promise<{ category: CategoryRow }> {
  return api(`/api/categories/${id}`, { method: 'PUT', body });
}

export function deleteCategory(id: string): Promise<void> {
  return api(`/api/categories/${id}`, { method: 'DELETE' });
}

/** A category change redraws both lists, and a delete uncategorises rows in each. */
export function refreshCategories(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: categoriesQuery.queryKey }),
    queryClient.invalidateQueries({ queryKey: wishesQuery.queryKey }),
    queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey }),
  ]);
}
