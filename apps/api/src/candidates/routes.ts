import {
  candidateFilterSchema,
  type Database,
  listCandidates,
  loadCandidate,
  readSettings,
  retainSchema,
  setRetain,
  startOfDayIn,
} from '@goodies-beacon/core';
import { Hono } from 'hono';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';

export interface CandidateRouteDeps {
  readonly db: Database;
}

/**
 * `/api/candidates` — the audit view (P1-15, requirement 6).
 *
 * The filter lives in the query string rather than in a body, so a link can carry it: the item
 * page's counts, and later a digest email, point at "this item's rejections" by URL.
 */
export function createCandidateRoutes({ db }: CandidateRouteDeps) {
  const routes = new Hono();

  routes.get('/', async (c) => {
    const filter = candidateFilterSchema.safeParse(dropEmpty(c.req.query()));
    if (!filter.success) {
      const [issue] = filter.error.issues;
      const field = issue?.path.join('.') ?? 'query';
      return errorResponse(
        c,
        400,
        'validation_failed',
        `${field} ${issue?.message ?? 'is invalid'}`,
      );
    }

    const since =
      filter.data.from === 'today'
        ? startOfDayIn((await readSettings(db)).instance.timezone, new Date())
        : undefined;
    const { rows, total } = await listCandidates(db, filter.data, since);
    return c.json({ candidates: rows, total, filter: filter.data });
  });

  routes.get('/:id', async (c) => {
    const candidate = await loadCandidate(db, c.req.param('id'));
    if (!candidate) return errorResponse(c, 404, 'not_found', 'No such candidate.');
    return c.json({ candidate });
  });

  /** The Retain toggle (§13). Everything else on the candidate page is Phase 5's feedback loop. */
  routes.patch('/:id', async (c) => {
    const body = await parseBody(c, retainSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    const retain = await setRetain(db, c.req.param('id'), body.value.retain);
    if (retain === undefined) return errorResponse(c, 404, 'not_found', 'No such candidate.');
    return c.json({ retain });
  });

  return routes;
}

/**
 * An absent filter and an empty one mean the same thing and must not be told apart: a form that
 * submits `?decision=` would otherwise fail the enum rather than showing everything.
 */
function dropEmpty(query: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ''));
}
