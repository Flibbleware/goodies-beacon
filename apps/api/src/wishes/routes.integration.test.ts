import {
  authSession,
  authUser,
  categories,
  createDb,
  createPool,
  type Database,
  type Logger,
  runMigrations,
  wantedItems,
  wishItems,
} from '@goodies-beacon/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../auth/cookies.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const PASSWORD = 'a-good-enough-password';
const SECRET_KEY = 'IqQ8Xn1rWQhTsm9gOZ4vKdLpEbYxAcRuNjFkHt2SwVo=';
const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, child: () => logger };
const MISSING = '00000000-0000-4000-8000-000000000000';
const SEARCH = 'https://www.ebay.co.uk/sch/i.html?_nkw=jurassic+park+vhs';

let pool: ReturnType<typeof createPool> | undefined;
let db: Database;
let app: ReturnType<typeof createApp>;
let cookie: string;
let csrf: string;
let vhs: string;
let toy: string;

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

interface WishBody {
  id: string;
  label: string;
  categoryId: string | null;
  searchUrl: string | null;
  tags: string[];
}

async function add(body: Record<string, unknown>): Promise<WishBody> {
  const res = await send('POST', '/api/wishes', body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { wish: WishBody }).wish;
}

describe.skipIf(!databaseUrl)('the wish list routes', () => {
  beforeAll(async () => {
    const url = databaseUrl as string;
    await runMigrations(url);
    pool = createPool(url);
    db = createDb(pool);
  });

  beforeEach(async () => {
    await db.delete(authSession);
    await db.delete(authUser);
    await db.delete(wishItems);
    await db.delete(wantedItems);
    await db.delete(categories);
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

    const category = async (name: string, icon: string) => {
      const made = await send('POST', '/api/categories', { name, icon, colour: 'blue' });
      return ((await made.json()) as { category: { id: string } }).category.id;
    };
    vhs = await category('VHS', 'cassette');
    toy = await category('Toy', 'robot');
  });

  it('needs a session', async () => {
    expect((await app.request('/api/wishes')).status).toBe(401);
  });

  it('adds wishes and lists them newest first', async () => {
    await add({ label: 'Jurassic Park', categoryId: vhs, searchUrl: SEARCH });
    await add({ label: 'Tamagotchi', categoryId: toy });

    const res = await app.request('/api/wishes', { headers: { cookie } });
    const { wishes } = (await res.json()) as { wishes: WishBody[] };

    expect(wishes.map((wish) => [wish.label, wish.categoryId, wish.searchUrl])).toEqual([
      ['Tamagotchi', toy, null],
      ['Jurassic Park', vhs, SEARCH],
    ]);
  });

  it('stores tags tidied, in the order given, and none when none are sent', async () => {
    const tagged = await add({
      label: 'Jurassic Park',
      categoryId: vhs,
      tags: [' big box ', 'Spielberg', 'BIG BOX', ''],
    });
    expect(tagged.tags).toEqual(['big box', 'Spielberg']);
    expect((await add({ label: 'x', categoryId: toy })).tags).toEqual([]);

    const res = await send('PUT', `/api/wishes/${tagged.id}`, {
      label: 'Jurassic Park',
      categoryId: vhs,
      tags: ['90s'],
    });
    expect(((await res.json()) as { wish: WishBody }).wish.tags).toEqual(['90s']);
  });

  it('refuses a tag the form could not give back', async () => {
    const res = await send('POST', '/api/wishes', {
      label: 'x',
      tags: ['big, box'],
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /^tags\.0 /,
    );
  });

  it('refuses a category that does not exist with a 400, not a foreign key 500', async () => {
    const res = await send('POST', '/api/wishes', {
      label: 'x',
      categoryId: '00000000-0000-4000-8000-000000000000',
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unknown_category');
  });

  it('leaves a wish uncategorised when its category is deleted', async () => {
    const wish = await add({ label: 'Jurassic Park', categoryId: vhs });

    expect((await send('DELETE', `/api/categories/${vhs}`)).status).toBe(204);

    const list = await app.request('/api/wishes', { headers: { cookie } });
    const { wishes } = (await list.json()) as { wishes: WishBody[] };
    expect(wishes).toMatchObject([{ id: wish.id, categoryId: null }]);
  });

  it('refuses a link that is not http or https', async () => {
    const res = await send('POST', '/api/wishes', {
      label: 'x',
      searchUrl: 'javascript:alert(1)',
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /^searchUrl /,
    );
  });

  it('edits a wish in place, link included', async () => {
    const wish = await add({ label: 'Jurasic Park', categoryId: toy, searchUrl: SEARCH });

    const res = await send('PUT', `/api/wishes/${wish.id}`, {
      label: 'Jurassic Park',
      categoryId: vhs,
      searchUrl: '',
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { wish: WishBody }).wish).toMatchObject({
      id: wish.id,
      label: 'Jurassic Park',
      categoryId: vhs,
      searchUrl: null,
    });
  });

  it('removes a wish', async () => {
    const wish = await add({ label: 'x' });

    expect((await send('DELETE', `/api/wishes/${wish.id}`)).status).toBe(204);
    expect((await send('DELETE', `/api/wishes/${wish.id}`)).status).toBe(404);
  });

  it('answers a missing or malformed id as not found rather than a 500', async () => {
    const body = { label: 'x' };

    expect((await send('PUT', `/api/wishes/${MISSING}`, body)).status).toBe(404);
    expect((await send('PUT', '/api/wishes/not-a-uuid', body)).status).toBe(404);
    expect((await send('DELETE', '/api/wishes/not-a-uuid')).status).toBe(404);
    expect((await send('POST', '/api/wishes/not-a-uuid/promote')).status).toBe(404);
  });

  it('promotes a wish to a draft wanted item and takes it off the list', async () => {
    const wish = await add({
      label: 'Jurassic Park',
      categoryId: vhs,
      searchUrl: SEARCH,
      tags: ['big box', '90s'],
    });

    const res = await send('POST', `/api/wishes/${wish.id}/promote`);
    expect(res.status).toBe(201);
    const { itemId, version } = (await res.json()) as { itemId: string; version: number };
    expect(version).toBe(1);

    const read = await app.request(`/api/items/${itemId}`, { headers: { cookie } });
    const { item } = (await read.json()) as {
      item: {
        title: string;
        status: string;
        categoryId: string;
        current: { document: Record<string, unknown> };
      };
    };
    expect(item.title).toBe('Jurassic Park');
    expect(item.status).toBe('draft');
    expect(item.categoryId).toBe(vhs);
    // Where the tags and link went, since an item has no field for either.
    expect(item.current.document.changeNote).toBe(
      `Promoted from the wish list; tagged big box, 90s; searched by hand at ${SEARCH}.`,
    );

    const list = await app.request('/api/wishes', { headers: { cookie } });
    expect(await list.json()).toEqual({ wishes: [] });
  });

  it('promotes a wish once, however many times it is asked', async () => {
    const wish = await add({ label: 'x' });

    const answers = await Promise.all([
      send('POST', `/api/wishes/${wish.id}/promote`),
      send('POST', `/api/wishes/${wish.id}/promote`),
    ]);

    expect(answers.map((res) => res.status).sort()).toEqual([201, 404]);
    expect(await db.select().from(wantedItems)).toHaveLength(1);
  });
});
