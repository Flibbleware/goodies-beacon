import { readFileSync } from 'node:fs';
import {
  authSession,
  authUser,
  candidates,
  createDb,
  createItem,
  createPool,
  type Database,
  itemSaveSchema,
  type Logger,
  listings,
  processHeartbeat,
  runMigrations,
  searchPlanState,
  seen,
  settings as settingsTable,
  verdicts,
  wantedItems,
  writeSettings,
} from '@goodies-beacon/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../auth/cookies.js';

const MEDIA_DIR = '/tmp/goodies-beacon-test-media';

const databaseUrl = process.env.TEST_DATABASE_URL;

const PASSWORD = 'a-good-enough-password';
const HOST = 'beacon.example.co.uk';
const SECRET_KEY = 'IqQ8Xn1rWQhTsm9gOZ4vKdLpEbYxAcRuNjFkHt2SwVo=';
const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, child: () => logger };

const FIXTURES = new URL('../../../../packages/core/src/domain/fixtures/', import.meta.url);
const carmageddon = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL('carmageddon.json', FIXTURES), 'utf8'));

interface DashboardBody {
  dashboard: {
    today: { matched: number; uncertain: number; rejected: number; waiting: number };
    items: { active: number; paused: number; draft: number; total: number };
    sources: {
      source: string;
      activePlans: number;
      lastError: string | null;
      failingItemTitle: string | null;
    }[];
    workers: { role: string; stale: boolean }[];
    timezone: string;
    budget: { ok: boolean; spentGbp: number | null; capGbp: number | null } | null;
  };
}

let pool: ReturnType<typeof createPool> | undefined;
let db: Database;
let app: ReturnType<typeof createApp>;
let cookie: string;
let itemId: string;
let specVersionId: string;

afterAll(async () => {
  await pool?.end();
});

function cookieValue(res: Response, name: string): string | undefined {
  const line = res.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  const pair = line?.split(';')[0];
  return pair?.slice(pair.indexOf('=') + 1);
}

const read = async (): Promise<DashboardBody['dashboard']> => {
  const res = await app.request('/api/dashboard', { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as DashboardBody).dashboard;
};

async function seedVerdict(decision: 'match' | 'uncertain' | 'reject'): Promise<void> {
  const [listing] = await db
    .insert(listings)
    .values({
      source: 'ebay',
      externalId: `listing-${decision}-${Math.random()}`,
      url: 'https://example.com/1',
      title: 'Carmageddon big box',
    })
    .returning({ id: listings.id });
  if (!listing) throw new Error('could not seed the listing');

  const [candidate] = await db
    .insert(candidates)
    .values({ wantedItemId: itemId, listingId: listing.id, specVersionId })
    .returning({ id: candidates.id });
  if (!candidate) throw new Error('could not seed the candidate');

  await db
    .insert(verdicts)
    .values({ candidateId: candidate.id, specVersionId, decision, criteriaResults: [] });
}

describe.skipIf(!databaseUrl)('the dashboard route', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(authSession);
    await db.delete(authUser);
    await db.delete(candidates);
    await db.delete(listings);
    await db.delete(seen);
    await db.delete(wantedItems);
    await db.delete(processHeartbeat);
    await db.delete(settingsTable);

    app = createApp({
      db,
      logger,
      config: {
        host: HOST,
        secretKey: SECRET_KEY,
        version: 'dev',
        sha: 'unknown',
        mediaDir: MEDIA_DIR,
        ai: {
          anthropicApiKey: undefined,
          openaiApiKey: undefined,
          googleGenerativeAiApiKey: undefined,
          openrouterApiKey: undefined,
          ollamaBaseUrl: undefined,
        },
      },
    });

    const start = await app.request('/api/auth/session');
    const token = cookieValue(start, CSRF_COOKIE) as string;
    const res = await app.request('/api/auth/first-run', {
      method: 'POST',
      headers: {
        cookie: `${CSRF_COOKIE}=${token}`,
        [CSRF_HEADER]: token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const csrf = cookieValue(res, CSRF_COOKIE) as string;
    cookie = `${SESSION_COOKIE}=${cookieValue(res, SESSION_COOKIE)}; ${CSRF_COOKIE}=${csrf}`;

    const created = await createItem(
      db,
      itemSaveSchema.parse({
        title: 'Carmageddon big box',
        status: 'active',
        spec: carmageddon(),
      }),
    );
    itemId = created.itemId;
    specVersionId = created.versionId;
  });

  it('needs a session', async () => {
    expect((await app.request('/api/dashboard')).status).toBe(401);
  });

  it('answers with every panel in one request', async () => {
    const dashboard = await read();

    expect(Object.keys(dashboard).sort()).toEqual([
      'budget',
      'items',
      'sources',
      'timezone',
      'today',
      'workers',
    ]);
  });

  it("counts today's verdicts and the items behind them", async () => {
    await seedVerdict('match');
    await seedVerdict('reject');

    const dashboard = await read();

    expect(dashboard.today).toMatchObject({ matched: 1, rejected: 1 });
    expect(dashboard.items).toEqual({ active: 1, paused: 0, draft: 0, total: 1 });
  });

  it('reads today in the configured time zone rather than in UTC', async () => {
    await writeSettings(db, { instance: { timezone: 'Asia/Tokyo' } }, SECRET_KEY);

    expect((await read()).timezone).toBe('Asia/Tokyo');
  });

  /** P1-16's acceptance line: the failure is on the page, not in a log. */
  it('puts an adapter failure and the item it belongs to on the page', async () => {
    await db.insert(searchPlanState).values({
      planId: 'ebay-gb-carmageddon',
      wantedItemId: itemId,
      source: 'ebay',
      lastRunAt: new Date(),
      lastError: 'eBay said 503',
    });

    const [source] = (await read()).sources;

    expect(source).toMatchObject({
      source: 'ebay',
      lastError: 'eBay said 503',
      failingItemTitle: 'Carmageddon big box',
    });
  });

  it('names a source whose plans have never run', async () => {
    const [source] = (await read()).sources;

    expect(source).toMatchObject({ source: 'ebay', activePlans: 3, lastError: null });
  });

  it('reports a process that has stopped checking in', async () => {
    await db.insert(processHeartbeat).values([
      { role: 'api', lastSeenAt: new Date() },
      { role: 'worker', lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) },
    ]);

    expect((await read()).workers).toEqual([
      { role: 'api', lastSeenAt: expect.any(String), stale: false },
      { role: 'worker', lastSeenAt: expect.any(String), stale: true },
    ]);
  });

  it('reports the month’s spend against the cap', async () => {
    expect((await read()).budget).toMatchObject({ ok: true, capGbp: null });

    await writeSettings(db, { ai: { monthlyBudget: { amount: 40, currency: 'GBP' } } }, SECRET_KEY);

    expect((await read()).budget).toMatchObject({ ok: true, spentGbp: 0, capGbp: 40 });
  });
});
