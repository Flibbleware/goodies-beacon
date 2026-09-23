import { readFileSync } from 'node:fs';
import {
  authSession,
  authUser,
  createDb,
  createPool,
  type Database,
  type Logger,
  runMigrations,
  wantedItems,
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

/** The same documents P1-02 keeps as the worked examples, so the editor is tested on real specs. */
const FIXTURES = new URL('../../../../packages/core/src/domain/fixtures/', import.meta.url);
const example = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8'));

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

async function send(method: string, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { cookie, [CSRF_HEADER]: csrf, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!databaseUrl)('the wanted item routes', () => {
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
    csrf = cookieValue(res, CSRF_COOKIE) as string;
    cookie = `${SESSION_COOKIE}=${cookieValue(res, SESSION_COOKIE)}; ${CSRF_COOKIE}=${csrf}`;
  });

  it('needs a session', async () => {
    expect((await app.request('/api/items')).status).toBe(401);
  });

  it('answers with an empty list before anything has been entered', async () => {
    const res = await app.request('/api/items', { headers: { cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  /** P1-20: the category is the item's own, saved with it and listed with it. */
  it('saves a category, lists it, and defaults to Other when none is sent', async () => {
    const spec = example('carmageddon');

    const game = await send('POST', '/api/items', { title: 'Carmageddon', category: 'game', spec });
    const other = await send('POST', '/api/items', { title: 'Unsorted', spec });
    expect(game.status).toBe(201);
    expect(other.status).toBe(201);
    const { itemId } = (await game.json()) as { itemId: string };

    const list = await app.request('/api/items', { headers: { cookie } });
    const { items } = (await list.json()) as { items: { title: string; category: string }[] };
    expect(Object.fromEntries(items.map((item) => [item.title, item.category]))).toEqual({
      Carmageddon: 'game',
      Unsorted: 'other',
    });

    // Changing it is a save like any other, and the item page reads it back.
    await send('PUT', `/api/items/${itemId}`, { title: 'Carmageddon', category: 'book', spec });
    const read = await app.request(`/api/items/${itemId}`, { headers: { cookie } });
    expect(((await read.json()) as { item: { category: string } }).item.category).toBe('book');

    const bad = await send('POST', '/api/items', { title: 'x', category: 'vinyl', spec });
    expect(bad.status).toBe(400);
  });

  /** P1-13's first acceptance line: both worked examples go in exactly as they are written. */
  it.each(['carmageddon', 'power-mac-5500'])('stores the %s example whole', async (name) => {
    const spec = example(name);

    const created = await send('POST', '/api/items', {
      title: 'A worked example',
      status: 'active',
      spec,
    });
    expect(created.status).toBe(201);
    const { itemId, version } = (await created.json()) as { itemId: string; version: number };
    expect(version).toBe(1);

    const read = await app.request(`/api/items/${itemId}`, { headers: { cookie } });
    const { item } = (await read.json()) as {
      item: { title: string; status: string; current: { document: Record<string, unknown> } };
    };

    expect(item.title).toBe('A worked example');
    expect(item.status).toBe('active');
    expect(item.current.document.settings).toEqual(spec.settings);
    expect(item.current.document.criteria).toEqual(spec.criteria);
    expect(item.current.document.searchPlans).toEqual(spec.searchPlans);
  });

  it('refuses a spec the schema rejects, and names the path', async () => {
    const spec = example('carmageddon');
    const criteria = spec.criteria as Record<string, unknown>[];

    const res = await send('POST', '/api/items', {
      title: 'Carmageddon big box',
      spec: { ...spec, criteria: [{ ...criteria[0], text: '' }] },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toBe('spec.criteria.0.text a criterion needs text');
    expect(await (await app.request('/api/items', { headers: { cookie } })).json()).toEqual({
      items: [],
    });
  });

  it('refuses a price ceiling in a currency it cannot compare', async () => {
    const spec = example('carmageddon');
    const settings = spec.settings as Record<string, unknown>;

    const res = await send('POST', '/api/items', {
      title: 'Carmageddon big box',
      spec: { ...spec, settings: { ...settings, priceCeiling: { amount: 120, currency: 'USD' } } },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('spec.settings.priceCeiling.currency');
  });

  it('refuses an item with no title', async () => {
    const res = await send('POST', '/api/items', { title: '  ', spec: example('carmageddon') });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('title a wanted item needs a title');
  });

  it('points at the field when the grading scale does not exist', async () => {
    const spec = example('carmageddon');
    const settings = spec.settings as Record<string, unknown>;

    const res = await send('POST', '/api/items', {
      title: 'Carmageddon big box',
      spec: {
        ...spec,
        settings: { ...settings, gradingScaleId: '00000000-0000-4000-8000-000000000000' },
      },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('unknown_grading_scale');
    expect(body.error.message).toContain('spec.settings.gradingScaleId');
  });

  it('saves a new version and leaves the old one readable in the history', async () => {
    const spec = example('carmageddon');
    const created = await send('POST', '/api/items', { title: 'Carmageddon', spec });
    const { itemId } = (await created.json()) as { itemId: string };

    const saved = await send('PUT', `/api/items/${itemId}`, {
      title: 'Carmageddon, Macintosh only',
      status: 'active',
      spec: { ...spec, summary: 'Macintosh only.' },
      changeNote: 'Dropped the PC release.',
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()) as { version: number }).toMatchObject({ version: 2 });

    const read = await app.request(`/api/items/${itemId}`, { headers: { cookie } });
    const { item } = (await read.json()) as {
      item: {
        title: string;
        current: { version: number };
        versions: { version: number; changeNote: string | null }[];
      };
    };

    expect(item.title).toBe('Carmageddon, Macintosh only');
    expect(item.current.version).toBe(2);
    expect(item.versions.map((row) => row.version)).toEqual([2, 1]);
    expect(item.versions[0]?.changeNote).toBe('Dropped the PC release.');
    expect(item.versions[1]?.changeNote).toBe('First version, entered by hand.');
  });

  describe('pause and resume', () => {
    it('changes the status without writing a spec version', async () => {
      const created = await send('POST', '/api/items', {
        title: 'Carmageddon',
        status: 'active',
        spec: example('carmageddon'),
      });
      const { itemId } = (await created.json()) as { itemId: string };

      const paused = await send('PATCH', `/api/items/${itemId}`, { status: 'paused' });
      expect(paused.status).toBe(200);
      expect(await paused.json()).toEqual({ status: 'paused' });

      const read = await app.request(`/api/items/${itemId}`, { headers: { cookie } });
      const { item } = (await read.json()) as {
        item: { status: string; versions: unknown[]; current: { version: number } };
      };

      expect(item.status).toBe('paused');
      // The history answers "what changed about the spec", and pausing changed nothing about it.
      expect(item.versions).toHaveLength(1);
      expect(item.current.version).toBe(1);
    });

    it('refuses a status that is not one', async () => {
      const created = await send('POST', '/api/items', {
        title: 'Carmageddon',
        spec: example('carmageddon'),
      });
      const { itemId } = (await created.json()) as { itemId: string };

      const res = await send('PATCH', `/api/items/${itemId}`, { status: 'sleeping' });

      expect(res.status).toBe(400);
    });

    it('answers 404 for an item that is not there', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';

      expect((await send('PATCH', `/api/items/${missing}`, { status: 'paused' })).status).toBe(404);
    });
  });

  describe('what the list and the item page carry', () => {
    it('gives every item its counts and its poll state', async () => {
      await send('POST', '/api/items', { title: 'Carmageddon', spec: example('carmageddon') });

      const res = await app.request('/api/items', { headers: { cookie } });
      const { items } = (await res.json()) as {
        items: {
          counts: Record<string, number>;
          lastPollAt: string | null;
          failingPlans: number;
        }[];
      };

      expect(items[0]?.counts).toEqual({
        candidates: 0,
        matched: 0,
        uncertain: 0,
        rejected: 0,
        pending: 0,
      });
      expect(items[0]?.lastPollAt).toBeNull();
      expect(items[0]?.failingPlans).toBe(0);
    });

    it('gives the item page a row per search plan, unrun ones included', async () => {
      const spec = example('carmageddon');
      const created = await send('POST', '/api/items', { title: 'Carmageddon', spec });
      const { itemId } = (await created.json()) as { itemId: string };

      const res = await app.request(`/api/items/${itemId}`, { headers: { cookie } });
      const { item } = (await res.json()) as {
        item: { plans: { planId: string; query: string; candidatesFound: number }[] };
      };

      expect(item.plans.map((plan) => plan.planId)).toEqual(
        (spec.searchPlans as { id: string }[]).map((plan) => plan.id),
      );
      expect(item.plans[0]).toMatchObject({ query: 'carmageddon', candidatesFound: 0 });
    });
  });

  it('answers 404 for an item that is not there', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    expect((await app.request(`/api/items/${missing}`, { headers: { cookie } })).status).toBe(404);
    expect(
      (await send('PUT', `/api/items/${missing}`, { title: 'x', spec: example('carmageddon') }))
        .status,
    ).toBe(404);
  });
});
