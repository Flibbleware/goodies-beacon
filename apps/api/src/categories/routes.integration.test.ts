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

interface CategoryBody {
  id: string;
  name: string;
  icon: string;
  colour: string;
  wishes: number;
  items: number;
}

async function add(body: Record<string, unknown>): Promise<CategoryBody> {
  const res = await send('POST', '/api/categories', body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { category: CategoryBody }).category;
}

async function list(): Promise<CategoryBody[]> {
  const res = await app.request('/api/categories', { headers: { cookie } });
  return ((await res.json()) as { categories: CategoryBody[] }).categories;
}

describe.skipIf(!databaseUrl)('the category routes', () => {
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
  });

  it('needs a session', async () => {
    expect((await app.request('/api/categories')).status).toBe(401);
  });

  it('adds categories and lists them A–Z, ignoring case, with what uses each', async () => {
    const vhs = await add({ name: ' VHS ', icon: 'cassette', colour: 'blue' });
    await add({ name: 'board games', icon: 'gamepad', colour: 'violet' });
    await send('POST', '/api/wishes', { label: 'Jurassic Park', categoryId: vhs.id });

    expect(vhs.name).toBe('VHS');
    expect((await list()).map((c) => [c.name, c.icon, c.colour, c.wishes, c.items])).toEqual([
      ['board games', 'gamepad', 'violet', 0, 0],
      ['VHS', 'cassette', 'blue', 1, 0],
    ]);
  });

  it('refuses a second category of the same name, whatever its case', async () => {
    const vhs = await add({ name: 'VHS', icon: 'cassette', colour: 'blue' });
    const dvd = await add({ name: 'DVD', icon: 'disc', colour: 'teal' });

    const again = await send('POST', '/api/categories', {
      name: 'vhs',
      icon: 'star',
      colour: 'blue',
    });
    expect(again.status).toBe(409);
    const renamed = await send('PUT', `/api/categories/${dvd.id}`, {
      name: 'Vhs',
      icon: 'disc',
      colour: 'teal',
    });
    expect(renamed.status).toBe(409);

    // Renaming a category to its own name in another case is not a clash with itself.
    const recased = await send('PUT', `/api/categories/${vhs.id}`, {
      name: 'vhs',
      icon: 'cassette',
      colour: 'blue',
    });
    expect(recased.status).toBe(200);
  });

  it('refuses an icon or colour it cannot draw', async () => {
    expect(
      (await send('POST', '/api/categories', { name: 'x', icon: 'dragon', colour: 'blue' })).status,
    ).toBe(400);
    expect(
      (await send('POST', '/api/categories', { name: 'x', icon: 'star', colour: 'red' })).status,
    ).toBe(400);
  });

  it('edits a category in place', async () => {
    const category = await add({ name: 'Toys', icon: 'robot', colour: 'pink' });

    const res = await send('PUT', `/api/categories/${category.id}`, {
      name: 'Toy',
      icon: 'heart',
      colour: 'fuchsia',
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { category: CategoryBody }).category).toMatchObject({
      id: category.id,
      name: 'Toy',
      icon: 'heart',
      colour: 'fuchsia',
    });
  });

  it('deletes a category, and answers a missing or malformed id as not found', async () => {
    const category = await add({ name: 'x', icon: 'star', colour: 'slate' });
    const body = { name: 'y', icon: 'star', colour: 'slate' };

    expect((await send('DELETE', `/api/categories/${category.id}`)).status).toBe(204);
    expect((await send('DELETE', `/api/categories/${category.id}`)).status).toBe(404);
    expect((await send('PUT', `/api/categories/${category.id}`, body)).status).toBe(404);
    expect((await send('PUT', '/api/categories/not-a-uuid', body)).status).toBe(404);
    expect((await send('DELETE', '/api/categories/not-a-uuid')).status).toBe(404);
  });
});
