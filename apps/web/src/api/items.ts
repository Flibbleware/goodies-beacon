import type {
  ItemSummary,
  NotificationMode,
  SpecVersionSummary,
  WantedItemStatus,
  WantedSpec,
} from '@goodies-beacon/core/schemas';
import { api } from './client.js';

/** The wire shape: JSON carries timestamps as ISO strings, not Dates. */
export type ItemRow = Omit<ItemSummary, 'updatedAt'> & { updatedAt: string };

export interface LoadedItem {
  id: string;
  title: string;
  status: WantedItemStatus;
  notificationMode: NotificationMode;
  pollEvery: string | null;
  createdAt: string;
  updatedAt: string;
  current: { versionId: string; version: number; document: Record<string, unknown> } | null;
  versions: (Omit<SpecVersionSummary, 'createdAt'> & { createdAt: string })[];
}

export interface SavedVersion {
  itemId: string;
  versionId: string;
  version: number;
}

export interface ItemSave {
  title: string;
  status: WantedItemStatus;
  spec: WantedSpec;
  changeNote: string | null;
}

export const itemsQuery = {
  queryKey: ['items'] as const,
  queryFn: () => api<{ items: ItemRow[] }>('/api/items'),
} as const;

export const itemQuery = (id: string) =>
  ({
    queryKey: ['items', id] as const,
    queryFn: () => api<{ item: LoadedItem }>(`/api/items/${id}`),
  }) as const;

export function createItem(body: ItemSave): Promise<SavedVersion> {
  return api<SavedVersion>('/api/items', { method: 'POST', body });
}

export function saveItem(id: string, body: ItemSave): Promise<SavedVersion> {
  return api<SavedVersion>(`/api/items/${id}`, { method: 'PUT', body });
}

export interface UploadedMedia {
  id: string;
  kind: string;
  path: string;
  label: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
}

/**
 * Multipart rather than JSON, so the bytes are not base64'd through the CSRF-protected client.
 * The token still travels: `POST /api/media` is state-changing like any other (§12).
 */
export async function uploadReferenceImage(file: File, label: string): Promise<UploadedMedia> {
  const form = new FormData();
  form.set('file', file);
  form.set('label', label);

  const token = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('gb_csrf='))
    ?.slice('gb_csrf='.length);

  const res = await fetch('/api/media', {
    method: 'POST',
    credentials: 'same-origin',
    headers: token ? { 'X-CSRF-Token': token } : {},
    body: form,
  });

  const payload = (await res.json().catch(() => undefined)) as
    | { media?: UploadedMedia; error?: { message: string } }
    | undefined;

  if (!res.ok || !payload?.media) {
    throw new Error(payload?.error?.message ?? `The upload failed with status ${res.status}.`);
  }
  return payload.media;
}
