import type { ItemCategory, Wish } from '@goodies-beacon/core/schemas';
import { api } from './client.js';
import type { SavedVersion } from './items.js';

/** JSON carries timestamps as ISO strings, so those two are restated (see items.ts). */
export type WishRow = Omit<Wish, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export interface WishSave {
  label: string;
  category: ItemCategory;
  searchUrl: string;
}

export const wishesQuery = {
  queryKey: ['wishes'] as const,
  queryFn: () => api<{ wishes: WishRow[] }>('/api/wishes'),
} as const;

export function createWish(body: WishSave): Promise<{ wish: WishRow }> {
  return api('/api/wishes', { method: 'POST', body });
}

export function updateWish(id: string, body: WishSave): Promise<{ wish: WishRow }> {
  return api(`/api/wishes/${id}`, { method: 'PUT', body });
}

export function deleteWish(id: string): Promise<void> {
  return api(`/api/wishes/${id}`, { method: 'DELETE' });
}

export function promoteWish(id: string): Promise<SavedVersion> {
  return api(`/api/wishes/${id}/promote`, { method: 'POST' });
}
