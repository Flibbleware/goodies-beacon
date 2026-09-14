import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { specVersions, wantedItems } from '../db/schema.js';
import { type SearchPlan, searchPlanSchema, specSettingsSchema } from '../domain/spec.js';
import type { Logger } from '../logger.js';
import { isMarketplaceSourceId, type MarketplaceSourceId } from '../sources.js';

/**
 * Which plans should be polling right now (§6).
 *
 * A plan is read out of the item's *current* spec version, which is immutable — so this is the
 * one place that decides what "active" means, and both the scheduler and the poll job ask it
 * rather than each deciding for themselves.
 */

export interface ActivePlan {
  wantedItemId: string;
  itemTitle: string;
  specVersionId: string;
  plan: SearchPlan;
  source: MarketplaceSourceId;
  /** The item's own interval, or null to use the instance default. ISO 8601. */
  pollEvery: string | null;
}

interface ItemRow {
  wantedItemId: string;
  itemTitle: string;
  pollEvery: string | null;
  specVersionId: string;
  settings: Record<string, unknown>;
  searchPlans: unknown[];
}

const columns = {
  wantedItemId: wantedItems.id,
  itemTitle: wantedItems.title,
  pollEvery: wantedItems.pollEvery,
  specVersionId: specVersions.id,
  settings: specVersions.settings,
  searchPlans: specVersions.searchPlans,
};

/**
 * Every plan of every active item that should have a schedule.
 *
 * Four things disable a plan and all four are honoured here rather than in the poll job: the item
 * is not `active`, the plan's `enabled` flag is off, the item's settings have switched that
 * marketplace off, or the source has no queue to schedule on. The last is why `_template` never
 * appears: it is storable but not pollable (see `sources.ts`).
 */
export async function activePlans(db: Database, logger?: Logger): Promise<ActivePlan[]> {
  const rows = await db
    .select(columns)
    .from(wantedItems)
    .innerJoin(specVersions, eq(specVersions.id, wantedItems.currentSpecVersionId))
    .where(eq(wantedItems.status, 'active'));

  return rows.flatMap((row) => plansOf(row, logger));
}

/** One plan by id, so a poll job can re-check the plan it was scheduled for without a full scan. */
export async function findActivePlan(
  db: Database,
  wantedItemId: string,
  planId: string,
  logger?: Logger,
): Promise<ActivePlan | undefined> {
  const [row] = await db
    .select(columns)
    .from(wantedItems)
    .innerJoin(specVersions, eq(specVersions.id, wantedItems.currentSpecVersionId))
    .where(and(eq(wantedItems.id, wantedItemId), eq(wantedItems.status, 'active')))
    .limit(1);

  if (!row) return undefined;
  return plansOf(row, logger).find((entry) => entry.plan.id === planId);
}

function plansOf(row: ItemRow, logger?: Logger): ActivePlan[] {
  const settings = specSettingsSchema.safeParse(row.settings);
  if (!settings.success) {
    // A spec that will not parse cannot be polled, but it must not stop the plans that will.
    logger?.warn('skipping an item whose spec settings do not parse', {
      wantedItemId: row.wantedItemId,
      issues: settings.error.issues.length,
    });
    return [];
  }

  const enabledSources = new Set<string>(settings.data.sources);
  const active: ActivePlan[] = [];

  for (const raw of row.searchPlans) {
    const parsed = searchPlanSchema.safeParse(raw);
    if (!parsed.success) {
      logger?.warn('skipping a search plan that does not parse', {
        wantedItemId: row.wantedItemId,
        issues: parsed.error.issues.length,
      });
      continue;
    }

    const plan = parsed.data;
    if (!plan.enabled) continue;
    if (!enabledSources.has(plan.source)) continue;
    if (!isMarketplaceSourceId(plan.source)) continue;

    active.push({
      wantedItemId: row.wantedItemId,
      itemTitle: row.itemTitle,
      specVersionId: row.specVersionId,
      plan,
      source: plan.source,
      pollEvery: row.pollEvery,
    });
  }

  return active;
}
