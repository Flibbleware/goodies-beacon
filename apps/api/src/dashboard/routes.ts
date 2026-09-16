import { checkBudget } from '@goodies-beacon/ai';
import {
  createConverter,
  type Database,
  dashboardSummary,
  type Logger,
  readSettings,
} from '@goodies-beacon/core';
import { Hono } from 'hono';

export interface DashboardRouteDeps {
  readonly db: Database;
  readonly logger: Logger;
}

/**
 * `/api/dashboard` — one request for the whole page (§14, P1-16).
 *
 * Five panels, five round trips would be five spinners on the page a session lands on. They are
 * read together instead, which also makes them consistent with each other: the item counts and
 * the source health are from the same instant rather than from whenever each finished.
 *
 * The spend is fetched here rather than in core because the budget cap lives in
 * `@goodies-beacon/ai` — it needs the price table, and core cannot depend on ai without a cycle.
 */
export function createDashboardRoutes({ db, logger }: DashboardRouteDeps) {
  const routes = new Hono();

  routes.get('/', async (c) => {
    const settings = await readSettings(db);

    const [summary, budget] = await Promise.all([
      dashboardSummary(db, { timezone: settings.instance.timezone, logger }),
      /**
       * A failure here must not take the page down with it: the spend is one panel, and the
       * others answer the question "is anything broken", which is exactly what someone is asking
       * when a query has just failed.
       */
      checkBudget({ db, logger, converter: createConverter(db, logger), settings }).catch(
        (error: unknown) => {
          logger.warn('could not read the AI spend for the dashboard', {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        },
      ),
    ]);

    return c.json({ dashboard: { ...summary, budget } });
  });

  return routes;
}
