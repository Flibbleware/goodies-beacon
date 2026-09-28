import type { AiRole } from '../domain/constants.js';
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

/** One role's calls over one period, in the dollars the ledger is kept in. */
export interface SpendFigure {
  calls: number;
  usd: number;
  /** False when any of the calls was to a model missing from the price table: `usd` is a floor. */
  known: boolean;
}

export interface RoleSpend {
  role: AiRole;
  /** Since midnight in the instance time zone, as the Today tiles count. */
  today: SpendFigure;
  /** The last seven days, so a Monday morning is not an empty week. */
  week: SpendFigure;
  /** The calendar month in UTC — the budget cap's month, so this column agrees with it. */
  month: SpendFigure;
}

/**
 * The spend by role and period (P1-33).
 *
 * Kept in dollars with the rate beside it, rather than converted here, because the rate is what
 * the page needs to show a per-call cost of a fraction of a penny: `toGbp` rounds to whole pence.
 */
export interface SpendBreakdown {
  /** Only the roles with a call in one of the periods, in pipeline order. */
  roles: RoleSpend[];
  /** The newest stored USD rate, or null when there is none and the page must show dollars. */
  usdPerGbp: number | null;
}

export interface DashboardSummary {
  today: TodayCounts;
  items: ItemCounts;
  sources: SourceHealth[];
  workers: WorkerLiveness[];
  /** The instance time zone "today" was read in, so the page can say which day it means. */
  timezone: string;
}
