import type { SourceId } from '../sources.js';

/**
 * What the dashboard shows (§14, P1-16).
 *
 * Shapes only, so the browser can import them: every figure here is also a link, and the page
 * needs the types to build those links without a second definition of what a figure is.
 */

/** Verdicts reached since midnight in the instance's own time zone, not since midnight UTC. */
export interface TodayCounts {
  matched: number;
  uncertain: number;
  rejected: number;
  /** Found today and not yet judged — the queue, rather than the outcome. */
  waiting: number;
}

export interface ItemCounts {
  active: number;
  paused: number;
  draft: number;
  total: number;
}

/**
 * One marketplace's health (§14): when it last ran, when it last worked, and what it said if the
 * two are not the same.
 */
export interface SourceHealth {
  source: SourceId | string;
  /** Plans in an active item's current spec, so a paused item's queries are not counted. */
  activePlans: number;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  /** The newest error across this source's plans, or null when nothing is failing. */
  lastError: string | null;
  failingPlans: number;
  /** Which item's plan is failing, so the dashboard links at the page that can act on it. */
  failingItemId: string | null;
  failingItemTitle: string | null;
}

/**
 * A process's liveness. `stale` rather than a timestamp comparison in the page, so "is the worker
 * running" is decided in one place against `HEARTBEAT_STALE_AFTER_MS`.
 */
export interface WorkerLiveness {
  role: string;
  lastSeenAt: Date;
  stale: boolean;
}

export interface DashboardSummary {
  today: TodayCounts;
  items: ItemCounts;
  sources: SourceHealth[];
  workers: WorkerLiveness[];
  /** The instance time zone "today" was read in, so the page can say which day it means. */
  timezone: string;
}
