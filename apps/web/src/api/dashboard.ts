import type {
  DashboardSummary,
  ItemCounts,
  SourceHealth,
  TodayCounts,
} from '@goodies-beacon/core/schemas';
import { api } from './client.js';

/** The wire shapes: JSON carries timestamps as ISO strings, not Dates. */
export type SourceRow = Omit<SourceHealth, 'lastRunAt' | 'lastSuccessAt'> & {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
};

export interface WorkerRow {
  role: string;
  lastSeenAt: string;
  stale: boolean;
}

/** `@goodies-beacon/ai`'s `BudgetState`, restated: the web app cannot import that package. */
export interface Budget {
  ok: boolean;
  spentGbp: number | null;
  capGbp: number | null;
  resetsAt: string;
}

export interface Dashboard extends Omit<DashboardSummary, 'sources' | 'workers'> {
  today: TodayCounts;
  items: ItemCounts;
  sources: SourceRow[];
  workers: WorkerRow[];
  /** Null when the spend could not be read; the rest of the page is still worth showing. */
  budget: Budget | null;
}

export const dashboardQuery = {
  queryKey: ['dashboard'] as const,
  queryFn: () => api<{ dashboard: Dashboard }>('/api/dashboard'),
} as const;
