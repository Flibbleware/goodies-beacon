import type { WantedItemStatus } from '@goodies-beacon/core/schemas';

export const STATUS_LABELS: Record<WantedItemStatus, string> = {
  draft: 'Draft — not polled',
  active: 'Active — polled on schedule',
  paused: 'Paused',
  found: 'Found',
  archived: 'Archived',
};
