import {
  authSession,
  authUser,
  createDb,
  createPool,
  type Database,
  type Logger,
  runMigrations,
  sharedCriteria,
  wantedItems,
} from '@goodies-beacon/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../auth/cookies.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const PASSWORD = 'a-good-enough-password';
const SECRET_KEY = 'IqQ8Xn1rWQhTsm9gOZ4vKdLpEbYxAcRuNjFkHt2SwVo=';
const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, child: () => logger };

let pool: ReturnType<typeof createPool> | undefined;
let db: Database;
let app: ReturnType<typeof createApp>;
let cookie: string;
let csrf: string;

afterAll(async () => {
  await pool?.end();
});

function cookieValue(res: Response, name: string): string | undefined {
  const line = res.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  const pair = line?.split(';')[0];
  return pair?.slice(pair.indexOf('=') + 1);
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { cookie, [CSRF_HEADER]: csrf, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface CriterionBody {
  id: string;
  key: string;
  text: string;
  kind: string | null;
  quantifiable: boolean | null;
  onUnknown: string | null;
  tags: string[];
  items: number;
}

const CLASSICS = {
  key: 'original-release-not-classics',
  text: 'The original release, not the Nintendo Classics re-release',
  kind: 'hard',
  quantifiable: true,
  tags: ['game boy'],
};

async function add(body: Record<string, unknown>): Promise<CriterionBody> {
  const res = await send('POST', '/api/shared-criteria', body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { criterion: CriterionBody }).criterion;
}

/** A draft whose one criterion is linked to the shared one, with the item's own choices. */
function itemUsing(key: string, text = 'stale text') {
  return {
    title: 'Tetris',
    spec: {
      settings: {},
      criteria: [{ id: key, shared: key, text, kind: 'soft', quantifiable: false }],
    },
  };
}

async function criterionOf(itemId: string): Promise<Record<string, unknown> | undefined> {
  const res = await app.request(`/api/items/${itemId}`, { headers: { cookie } });
  const { item } = (await res.json()) as {
    item: { current: { version: number; document: { criteria: Record<string, unknown>[] } } };
  };
  return { version: item.current.version, ...item.current.document.criteria[0] };
}

describe.skipIf(!databaseUrl)('the shared criterion routes', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(authSession);
    await db.delete(authUser);
    await db.delete(wantedItems);
    await db.delete(sharedCriteria);
    app = createApp({
      db,
      logger,
      config: {
        host: 'beacon.example.co.uk',
        secretKey: SECRET_KEY,
        version: 'dev',
        sha: 'unknown',
        mediaDir: '/tmp/goodies-beacon-test-media',
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
    csrf = cookieValue(res, CSRF_COOKIE) as string;
    cookie = `${SESSION_COOKIE}=${cookieValue(res, SESSION_COOKIE)}; ${CSRF_COOKIE}=${csrf}`;
  });

  it('needs a session', async () => {
    expect((await app.request('/api/shared-criteria')).status).toBe(401);
  });

  it('adds, lists and refuses a second with the same identifier', async () => {
    const added = await add(CLASSICS);
    expect(added).toMatchObject({ ...CLASSICS, onUnknown: null, items: 0 });

    const res = await app.request('/api/shared-criteria', { headers: { cookie } });
    const { criteria } = (await res.json()) as { criteria: CriterionBody[] };
    expect(criteria.map(({ key }) => key)).toEqual([CLASSICS.key]);

    const twin = await send('POST', '/api/shared-criteria', CLASSICS);
    expect(twin.status).toBe(409);
    expect(((await twin.json()) as { error: { code: string } }).error.code).toBe(
      'duplicate_shared_criterion',
    );
  });

  it('refuses an identifier that is not lowercase and hyphenated', async () => {
    const res = await send('POST', '/api/shared-criteria', { ...CLASSICS, key: 'Not Classics' });
    expect(res.status).toBe(400);
  });

  it('refuses an update that names an identifier, since it is fixed', async () => {
    const added = await add(CLASSICS);
    const { key: _, ...fields } = CLASSICS;
    const res = await send('PUT', `/api/shared-criteria/${added.id}`, { ...fields, key: 'x' });
    expect(res.status).toBe(400);
  });

  it('fills a linked criterion in on an item save, and refuses one that names nothing', async () => {
    const unknown = await send('POST', '/api/items', itemUsing('nothing-by-this-name'));
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      'unknown_shared_criterion',
    );

    await add(CLASSICS);
    const created = await send('POST', '/api/items', itemUsing(CLASSICS.key));
    expect(created.status).toBe(201);
    const { itemId } = (await created.json()) as { itemId: string };

    expect(await criterionOf(itemId)).toEqual({
      version: 1,
      id: CLASSICS.key,
      shared: CLASSICS.key,
      text: CLASSICS.text,
      kind: 'hard',
      quantifiable: true,
      onUnknown: 'surface',
    });
  });

  it('says how many items an update gave a new version, and a delete unlinks them', async () => {
    const added = await add(CLASSICS);
    const created = await send('POST', '/api/items', itemUsing(CLASSICS.key));
    const { itemId } = (await created.json()) as { itemId: string };

    const { key: _, ...fields } = CLASSICS;
    const res = await send('PUT', `/api/shared-criteria/${added.id}`, {
      ...fields,
      text: 'Reworded',
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { criterion: CriterionBody; updatedItems: number };
    expect(updated.updatedItems).toBe(1);
    expect(updated.criterion).toMatchObject({ text: 'Reworded', items: 1 });
    expect(await criterionOf(itemId)).toMatchObject({ version: 2, text: 'Reworded' });

    expect((await send('DELETE', `/api/shared-criteria/${added.id}`)).status).toBe(204);
    const kept = await criterionOf(itemId);
    expect(kept).toMatchObject({ version: 3, id: CLASSICS.key, text: 'Reworded' });
    expect(kept).not.toHaveProperty('shared');

    expect((await send('DELETE', `/api/shared-criteria/${added.id}`)).status).toBe(404);
    expect((await send('PUT', '/api/shared-criteria/not-a-uuid', fields)).status).toBe(404);
  });
});
