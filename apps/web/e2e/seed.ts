import {
  candidates,
  createDb,
  createPool,
  listings,
  media,
  processHeartbeat,
  searchPlanState,
  verdicts,
  wantedItems,
} from '@goodies-beacon/core';

/**
 * Candidates written straight into the database, for the parts of the UI that cannot be reached
 * any other way.
 *
 * Getting one honestly means a real poll against eBay and a real model call, which the smoke test
 * has neither credentials nor any business doing. What it *can* prove is that the audit view
 * renders real rows through the real query — so the rows are seeded and everything after that is
 * the application: the API, the filters, the verdict, the prompt, and the page on a phone.
 *
 * Written with no query helpers beyond the tables, because `drizzle-orm` is not a dependency of
 * the web app and must not become one: rows are read in full and matched here instead. The
 * database is reset per run and holds a handful of rows, so that costs nothing.
 */

export interface SeedOptions {
  title: string;
  externalId: string;
  decision: 'match' | 'uncertain' | 'reject';
  reason?: 'over_budget' | 'negative_keyword' | 'prefilter';
  criteriaResults?: { criterionId: string; result: string; evidence: string }[];
  englishSummary?: string;
  description?: string;
  promptText?: string;
}

export async function seedCandidates(
  databaseUrl: string,
  wantedItemId: string,
  entries: SeedOptions[],
): Promise<void> {
  const pool = createPool(databaseUrl);

  try {
    const db = createDb(pool);

    const item = (await db.select().from(wantedItems)).find((row) => row.id === wantedItemId);
    if (!item?.currentSpecVersionId) throw new Error(`no current spec version for ${wantedItemId}`);
    const specVersionId = item.currentSpecVersionId;

    // The reference image the smoke test uploaded, reused as the listing's photograph so the
    // gallery and the "Show prompt" thumbnails have something real to serve.
    const [photo] = await db.select().from(media);

    for (const entry of entries) {
      const [listing] = await db
        .insert(listings)
        .values({
          source: 'ebay',
          externalId: entry.externalId,
          url: `https://www.ebay.co.uk/itm/${entry.externalId}`,
          title: entry.title,
          description: entry.description ?? null,
          priceAmount: '120.00',
          priceCurrency: 'USD',
          priceGbp: '95.00',
          buyingType: 'fixed',
          itemLocationCountry: 'US',
          shipsToUk: entry.decision === 'uncertain' ? 'unknown' : 'yes',
          images: photo ? [{ url: 'https://example.invalid/photo.jpg', mediaId: photo.id }] : [],
        })
        .returning({ id: listings.id });
      if (!listing) throw new Error('could not seed the listing');

      const [candidate] = await db
        .insert(candidates)
        .values({
          wantedItemId,
          listingId: listing.id,
          specVersionId,
          stage: 'reviewed',
        })
        .returning({ id: candidates.id });
      if (!candidate) throw new Error('could not seed the candidate');

      await db.insert(verdicts).values({
        candidateId: candidate.id,
        specVersionId,
        decision: entry.decision,
        reason: entry.reason ?? null,
        criteriaResults: entry.criteriaResults ?? [],
        englishSummary: entry.englishSummary ?? null,
        modelRole: entry.reason ? 'prefilter' : 'reviewer',
        model: entry.reason ? 'openai:gpt-5-nano' : 'openai:gpt-5-mini',
        promptText: entry.promptText ?? null,
        promptImages:
          entry.promptText && photo
            ? [{ mediaId: photo.id, label: 'UK big box, front', kind: 'reference' }]
            : null,
        inputTokens: 4000,
        outputTokens: 200,
        costUsd: '0.004000',
      });
    }
  } finally {
    await pool.end();
  }
}

/**
 * A search plan that ran and failed, so P1-16's "an adapter failure is visible without opening a
 * log" can be driven. The same thing a real poll writes when eBay answers 503 (§6).
 */
export async function seedPlanFailure(
  databaseUrl: string,
  wantedItemId: string,
  error: string,
): Promise<void> {
  const pool = createPool(databaseUrl);

  try {
    const db = createDb(pool);
    await db.insert(searchPlanState).values({
      planId: 'ebay-gb-carmageddon',
      wantedItemId,
      source: 'ebay',
      lastRunAt: new Date(),
      lastError: error,
    });
  } finally {
    await pool.end();
  }
}

/**
 * Two processes, one answering and one that stopped an hour ago (§14's worker heartbeat).
 *
 * Upserted, not inserted. The server under test runs the real heartbeat every five minutes by the
 * clock, not five minutes after it starts, so a run that crosses :00, :05, :10… has an `api` row
 * written before this step, and a plain insert failed on it — intermittently, depending only on
 * what time the run started.
 */
export async function seedHeartbeats(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  const db = createDb(pool);

  try {
    for (const row of [
      { role: 'api' as const, lastSeenAt: new Date() },
      { role: 'worker' as const, lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) },
    ]) {
      await db
        .insert(processHeartbeat)
        .values(row)
        .onConflictDoUpdate({ target: processHeartbeat.role, set: { lastSeenAt: row.lastSeenAt } });
    }
  } finally {
    await pool.end();
  }
}
