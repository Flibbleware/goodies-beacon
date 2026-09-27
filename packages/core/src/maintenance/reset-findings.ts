import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, sql, TransactionRollbackError } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { Database } from '../db/client.js';
import { candidates, costLedger, events, listings, searchPlanState, seen } from '../db/schema.js';
import { REVIEW_QUEUE } from '../queue/names.js';
import { SOURCE_IDS } from '../sources.js';

/**
 * Clearing out everything the instance has found while keeping everything it was asked to look
 * for (RUNNING.md, *Resetting what has been found*).
 *
 * Gone: candidates with their verdicts, notifications and feedback; listings, `seen`, and the
 * listing photos no one else uses; the cost ledger and the budget events it raised; each plan's
 * stats. Kept: wanted items and every spec version, reference and display images, categories,
 * shared criteria, wishes, settings, credentials, cookies and rates. Every plan then starts from
 * now, as §6 has a newly active plan do.
 */

export interface ResetSummary {
  candidates: number;
  listings: number;
  seen: number;
  listingImages: number;
  costRows: number;
  /** What the ledger held before it was cleared, so the figure can be written down first. */
  spend: { thisMonthUsd: string; allTimeUsd: string; unpricedCalls: number };
  budgetEvents: number;
  plans: number;
  /** Image files deleted from the media directory; zero on a preview. */
  filesRemoved: number;
}

export interface ResetOptions {
  mediaDir: string;
  /** False runs every delete and rolls back, so the preview's counts are the real ones. */
  apply: boolean;
}

export async function resetFindings(db: Database, options: ResetOptions): Promise<ResetSummary> {
  let summary: ResetSummary | undefined;
  let files: string[] = [];

  try {
    await db.transaction(async (tx) => {
      ({ summary, files } = await clear(tx as unknown as Database));
      if (!options.apply) tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }

  if (!summary) throw new Error('the reset produced no summary');

  // After the commit, never inside it: a file removed for a transaction that then rolled back
  // would leave a row pointing at nothing.
  if (options.apply) summary.filesRemoved = await removeFiles(options.mediaDir, files);
  return summary;
}

async function clear(db: Database): Promise<{ summary: ResetSummary; files: string[] }> {
  const [spend] = await db
    .select({
      thisMonthUsd: sql<string>`coalesce(sum(${costLedger.costUsd}) filter (where ${costLedger.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'), 0)::text`,
      allTimeUsd: sql<string>`coalesce(sum(${costLedger.costUsd}), 0)::text`,
      unpricedCalls: sql<number>`(count(*) filter (where not ${costLedger.costKnown}))::int`,
    })
    .from(costLedger);

  const costRows = (await db.delete(costLedger)).rowCount ?? 0;
  const budgetEvents =
    (await db.delete(events).where(eq(events.kind, 'budget_exceeded'))).rowCount ?? 0;
  const candidateRows = (await db.delete(candidates)).rowCount ?? 0;
  const listingRows = (await db.delete(listings)).rowCount ?? 0;
  const seenRows = (await db.delete(seen)).rowCount ?? 0;

  /**
   * By reference, not by kind alone: images are deduplicated on their content, so a listing photo
   * later used as a reference or display image is the same row and the same file.
   */
  const images = await db.execute<{ path: string; thumbnail_path: string | null }>(sql`
    delete from media m
    where m.kind = 'listing'
      and not exists (select 1 from wanted_items w where w.display_image_id = m.id)
      and not exists (
        select 1 from spec_versions s, jsonb_array_elements(s.reference_images) r
        where r->>'id' = m.id::text
      )
      and not exists (
        select 1 from grading_scales g where g.grades::text like '%' || m.id::text || '%'
      )
    returning m.path, m.thumbnail_path
  `);

  // A current plan that has never polled has no row yet; it gets one so it too starts from now.
  await db.execute(sql`
    insert into search_plan_state (plan_id, wanted_item_id, source, watermark)
    select p->>'id', w.id, p->>'source', now()
    from wanted_items w
    join spec_versions s on s.id = w.current_spec_version_id
    cross join jsonb_array_elements(s.search_plans) p
    where p->>'id' is not null
      and p->>'source' in (${sql.join(
        SOURCE_IDS.map((id) => sql`${id}`),
        sql`, `,
      )})
    on conflict (plan_id) do nothing
  `);

  const plans =
    (
      await db.update(searchPlanState).set({
        watermark: sql`now()`,
        backlogFrom: null,
        backlogUntil: null,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        candidatesFound: 0,
        candidatesReviewed: 0,
        candidatesMatched: 0,
        candidatesUncertain: 0,
        prefilterCostUsd: '0',
        updatedAt: new Date(),
      })
    ).rowCount ?? 0;

  return {
    summary: {
      candidates: candidateRows,
      listings: listingRows,
      seen: seenRows,
      listingImages: images.rowCount ?? 0,
      costRows,
      spend: spend ?? { thisMonthUsd: '0', allTimeUsd: '0', unpricedCalls: 0 },
      budgetEvents,
      plans,
      filesRemoved: 0,
    },
    files: images.rows.flatMap((row) =>
      row.thumbnail_path ? [row.path, row.thumbnail_path] : [row.path],
    ),
  };
}

async function removeFiles(mediaDir: string, files: readonly string[]): Promise<number> {
  let removed = 0;
  for (const file of files) {
    try {
      await unlink(join(mediaDir, file));
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

/**
 * Deletes every poll and review job, queued or not, and returns the queues it cleared. The poll
 * *schedules* are left alone: they are what brings the next poll, from the new starting point.
 */
export async function clearFindingJobs(boss: PgBoss): Promise<string[]> {
  const queues = await boss.getQueues();
  const cleared = queues
    .map((queue) => queue.name)
    .filter((name) => name === REVIEW_QUEUE || name.startsWith('poll.'));

  for (const name of cleared) await boss.deleteAllJobs(name);
  return cleared;
}

/** Anything else connected to this database, by application name — a running app, above all. */
export async function otherConnections(db: Database): Promise<string[]> {
  const result = await db.execute<{ name: string }>(sql`
    select coalesce(nullif(application_name, ''), 'an unnamed client') as name
    from pg_stat_activity
    where datname = current_database()
      and pid <> pg_backend_pid()
      and backend_type = 'client backend'
  `);
  return [...new Set(result.rows.map((row) => row.name))];
}
