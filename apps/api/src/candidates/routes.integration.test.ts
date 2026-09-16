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
  runMigrations,
  seen,
  verdicts,
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

const FIXTURES = new URL('../../../../packages/core/src/domain/fixtures/', import.meta.url);
const carmageddon = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL('carmageddon.json', FIXTURES), 'utf8'));

let pool: ReturnType<typeof createPool> | undefined;
let db: Database;
let app: ReturnType<typeof createApp>;
let cookie: string;
let csrf: string;
let itemId: string;
let specVersionId: string;
let sequence = 0;

afterAll(async () => {
  await pool?.end();
});

function cookieValue(res: Response, name: string): string | undefined {
  const line = res.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  const pair = line?.split(';')[0];
  return pair?.slice(pair.indexOf('=') + 1);
}

const get = (path: string) => app.request(path, { headers: { cookie } });

const patch = (path: string, body: unknown) =>
  app.request(path, {
    method: 'PATCH',
    headers: { cookie, [CSRF_HEADER]: csrf, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function seed(decision?: 'match' | 'uncertain' | 'reject'): Promise<string> {
  sequence += 1;

  const [listing] = await db
    .insert(listings)
    .values({
      source: 'ebay',
      externalId: `listing-${sequence}`,
      url: `https://example.com/${sequence}`,
      title: 'Carmageddon big box',
      priceGbp: '95.00',
    })
    .returning({ id: listings.id });
  if (!listing) throw new Error('could not seed the listing');

  const [candidate] = await db
    .insert(candidates)
    .values({ wantedItemId: itemId, listingId: listing.id, specVersionId })
    .returning({ id: candidates.id });
  if (!candidate) throw new Error('could not seed the candidate');

  if (decision) {
    await db.insert(verdicts).values({
      candidateId: candidate.id,
      specVersionId,
      decision,
      criteriaResults: [{ criterionId: 'big-box', result: 'pass', evidence: 'the box is shown' }],
      promptText: 'SYSTEM\n\n# The listing',
      promptImages: [
        { mediaId: '11111111-1111-4111-8111-111111111111', label: 'front', kind: 'reference' },
      ],
    });
  }

  return candidate.id;
}

describe.skipIf(!databaseUrl)('the candidate routes', () => {
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
    sequence = 0;

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

    const created = await createItem(
      db,
      itemSaveSchema.parse({ title: 'Carmageddon big box', spec: carmageddon() }),
    );
    itemId = created.itemId;
    specVersionId = created.versionId;
  });

  it('needs a session', async () => {
    expect((await app.request('/api/candidates')).status).toBe(401);
  });

  it('answers with an empty list and echoes the filter it applied', async () => {
    const res = await get('/api/candidates');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      candidates: [],
      total: 0,
      filter: { decision: 'all', origin: 'all', limit: 50, offset: 0 },
    });
  });

  it('filters by item and verdict from the query string, so a link can carry it', async () => {
    await seed('match');
    await seed('reject');

    const res = await get(`/api/candidates?wantedItemId=${itemId}&decision=reject`);
    const body = (await res.json()) as { candidates: { decision: string }[]; total: number };

    expect(body.total).toBe(1);
    expect(body.candidates[0]?.decision).toBe('reject');
  });

  /** A form that submits `?decision=` means "everything", not "an empty string is not a verdict". */
  it('treats an empty filter as an absent one', async () => {
    await seed('match');

    const res = await get('/api/candidates?decision=&origin=&wantedItemId=');

    expect(res.status).toBe(200);
    expect((await res.json()) as { total: number }).toMatchObject({ total: 1 });
  });

  it('refuses a filter it cannot understand, and names it', async () => {
    const res = await get('/api/candidates?decision=maybe');

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toContain('decision');
  });

  it('gives the candidate page its verdict, evidence and the prompt that was sent', async () => {
    const candidateId = await seed('match');

    const res = await get(`/api/candidates/${candidateId}`);
    const { candidate } = (await res.json()) as {
      candidate: {
        itemTitle: string;
        specVersion: number;
        verdicts: {
          decision: string;
          criteriaResults: { criterion: { text: string } | null; evidence: string }[];
          promptText: string;
          promptImages: { mediaId: string; label: string }[];
        }[];
      };
    };

    expect(candidate.itemTitle).toBe('Carmageddon big box');
    expect(candidate.specVersion).toBe(1);
    expect(candidate.verdicts[0]?.decision).toBe('match');
    expect(candidate.verdicts[0]?.criteriaResults[0]?.criterion?.text).toBe(
      'Big box release, not the jewel case or budget re-release',
    );
    expect(candidate.verdicts[0]?.promptText).toBe('SYSTEM\n\n# The listing');
    expect(candidate.verdicts[0]?.promptImages[0]?.label).toBe('front');
  });

  it('toggles retain', async () => {
    const candidateId = await seed('match');

    expect(await (await patch(`/api/candidates/${candidateId}`, { retain: true })).json()).toEqual({
      retain: true,
    });

    const res = await get(`/api/candidates/${candidateId}`);
    expect(((await res.json()) as { candidate: { retain: boolean } }).candidate.retain).toBe(true);
  });

  it('refuses a retain that is not a boolean', async () => {
    const candidateId = await seed('match');

    expect((await patch(`/api/candidates/${candidateId}`, { retain: 'yes' })).status).toBe(400);
  });

  it('answers 404 for a candidate that is not there', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    expect((await get(`/api/candidates/${missing}`)).status).toBe(404);
    expect((await patch(`/api/candidates/${missing}`, { retain: true })).status).toBe(404);
  });
});
