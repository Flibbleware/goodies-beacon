import type {
  SharedCriterion,
  SharedCriterionCreateInput,
  SharedCriterionUpdateInput,
} from '@goodies-beacon/core/schemas';
import type { QueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import { itemsQuery } from './items.js';

/** JSON carries timestamps as ISO strings, so those two are restated (see items.ts). */
export type SharedCriterionRow = Omit<SharedCriterion, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export const sharedCriteriaQuery = {
  queryKey: ['shared-criteria'] as const,
  queryFn: () => api<{ criteria: SharedCriterionRow[] }>('/api/shared-criteria'),
} as const;

export function createSharedCriterion(
  body: SharedCriterionCreateInput,
): Promise<{ criterion: SharedCriterionRow }> {
  return api('/api/shared-criteria', { method: 'POST', body });
}

export function updateSharedCriterion(
  id: string,
  body: SharedCriterionUpdateInput,
): Promise<{ criterion: SharedCriterionRow; updatedItems: number }> {
  return api(`/api/shared-criteria/${id}`, { method: 'PUT', body });
}

export function deleteSharedCriterion(id: string): Promise<void> {
  return api(`/api/shared-criteria/${id}`, { method: 'DELETE' });
}

/** A save or a delete can write a version on any item using it, so every item is redrawn. */
export function refreshSharedCriteria(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: sharedCriteriaQuery.queryKey }),
    queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey }),
  ]);
}
