import type {
  CandidateCounts,
  ItemPatchInput,
  ItemSummary,
  NotificationMode,
  PlanStats,
  SpecVersionSummary,
  WantedItemStatus,
  WantedSpec,
} from '@goodies-beacon/core/schemas';
import { api } from './client.js';

/**
 * The wire shapes. JSON carries timestamps as ISO strings, so the date fields are restated rather
 * than inherited; everything else comes from the server's own types and cannot drift from them.
 */
export type ItemRow = Omit<ItemSummary, 'updatedAt' | 'lastPollAt' | 'lastSuccessAt'> & {
  updatedAt: string;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
};

export type PlanRow = Omit<
  PlanStats,
  'watermark' | 'backlogUntil' | 'lastRunAt' | 'lastSuccessAt'
> & {
  watermark: string | null;
  backlogUntil: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
};

export interface LoadedItem {
  id: string;
  title: string;
  status: WantedItemStatus;
  categoryId: string | null;
  displayImageId: string | null;
  notificationMode: NotificationMode;
  pollEvery: string | null;
  createdAt: string;
  updatedAt: string;
  current: { versionId: string; version: number; document: Record<string, unknown> } | null;
  versions: (Omit<SpecVersionSummary, 'createdAt'> & { createdAt: string })[];
  plans: PlanRow[];
  counts: CandidateCounts;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  failingPlans: number;
}

export interface SavedVersion {
  itemId: string;
  versionId: string;
  version: number;
}

export interface ItemSave {
  title: string;
  status: WantedItemStatus;
  categoryId: string | null;
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

/**
 * Pause and resume, the title, the category and the display image. Not a save: it writes no spec
 * version (§14, P1-25).
 */
export function updateItem(id: string, patch: ItemPatchInput): Promise<unknown> {
  return api(`/api/items/${id}`, { method: 'PATCH', body: patch });
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
export async function uploadImage(file: File, label?: string): Promise<UploadedMedia> {
  const form = new FormData();
  form.set('file', file);
  if (label !== undefined) form.set('label', label);

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
