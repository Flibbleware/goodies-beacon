import type { WantedItemStatus } from '@goodies-beacon/core/schemas';

export const STATUS_LABELS: Record<WantedItemStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  found: 'Found',
  archived: 'Archived',
};
