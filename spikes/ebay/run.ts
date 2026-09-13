/**
 * S1-01 — eBay Browse API spike.
 *
 * Answers the four questions in the development plan: does Browse work on a standard production
 * keyset without further approval and what is the quota; which fields come back from
 * `item_summary/search` versus `getItem`; how "worldwide" behaves on EBAY_GB and whether
 * `itemLocationCountry` takes more than one value; and it records the fixtures P1-03's harness
 * and P1-04's tests replay.
 *
 * Throwaway by design (see spikes/README.md). Run: `node spikes/ebay/run.ts`
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnonymiser } from './anonymise.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const FIXTURES = join(REPO, 'packages', 'sources', 'ebay', 'fixtures');

/**
 * Sandbox exists to prove the plumbing — token, marketplace header, filter syntax — before a
 * production keyset is in hand. It answers none of S1-01's questions: its catalogue is synthetic,
 * so §16's "eBay's sandbox data is not useful" holds, and a sandbox run deliberately writes no
 * fixtures. The production run is what ticks the boxes.
 */
const ENVIRONMENT = process.env.EBAY_ENV ?? 'production';
if (ENVIRONMENT !== 'production' && ENVIRONMENT !== 'sandbox') {
  console.error(`EBAY_ENV must be 'production' or 'sandbox', not '${ENVIRONMENT}'.`);
  process.exit(1);
}
const IS_SANDBOX = ENVIRONMENT === 'sandbox';
const API = IS_SANDBOX ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
const BROWSE = `${API}/buy/browse/v1`;

/** Polite spacing between calls. The spike is not the thing that should burn the daily quota. */
const DELAY_MS = 400;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Call = {
  name: string;
  question: string;
  url: string;
  marketplace?: string;
  status: number;
  ok: boolean;
  durationMs: number;
  error?: unknown;
  /** Present on searches. A 200 with nothing in it is a different answer from a 200 with results. */
  total?: number;
  returned?: number;
};

type Summary = Record<string, unknown> & {
  itemId?: string;
  buyingOptions?: string[];
  itemLocation?: { country?: string };
};
type SearchBody = { itemSummaries?: Summary[]; total?: number; next?: string; warnings?: unknown };

const calls: Call[] = [];
const bodies = new Map<string, unknown>();
const searchProbes: string[] = [];

function readCredentials(): { id: string; secret: string } {
  try {
    process.loadEnvFile(join(REPO, '.env'));
  } catch {
    // No .env is fine if the variables are already exported.
  }
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) {
    console.error(
      [
        'EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not set.',
        '',
        'Get them from https://developer.ebay.com → Application Keys, from the row matching',
        `EBAY_ENV (currently ${ENVIRONMENT}):`,
        '  EBAY_CLIENT_ID     is the "App ID (Client ID)"',
        '  EBAY_CLIENT_SECRET is the "Cert ID (Client Secret)"',
        'A production Cert ID starts PRD-, a sandbox one SBX-.',
        '',
        'Put them in the repository .env, which is gitignored, then run this again.',
      ].join('\n'),
    );
    process.exit(1);
  }
  return { id, secret };
}

/**
 * Application token by client credentials. This call is itself one of the spike's answers: a
 * keyset that has not been granted Browse fails here or at the first search, not silently.
 */
async function getToken(id: string, secret: string) {
  const started = Date.now();
  const response = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  calls.push({
    name: 'oauth.client_credentials',
    question: 'Does a standard production keyset get an application token?',
    url: `${API}/identity/v1/oauth2/token`,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - started,
    ...(response.ok ? {} : { error: body }),
  });

  if (!response.ok || !body.access_token) {
    console.error(`\nToken request failed (${response.status}):`, body);
    process.exit(1);
  }
  console.log(`  token ok — expires in ${body.expires_in}s`);
  return body.access_token;
}

async function call(
  token: string,
  opts: { name: string; question: string; url: string; marketplace?: string },
): Promise<unknown> {
  await sleep(DELAY_MS);
  const started = Date.now();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (opts.marketplace) headers['X-EBAY-C-MARKETPLACE-ID'] = opts.marketplace;

  let status = 0;
  let ok = false;
  let body: unknown;
  try {
    const response = await fetch(opts.url, { headers });
    status = response.status;
    ok = response.ok;
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch (cause) {
    body = { transportError: cause instanceof Error ? cause.message : String(cause) };
  }

  calls.push({
    name: opts.name,
    question: opts.question,
    url: opts.url,
    ...(opts.marketplace ? { marketplace: opts.marketplace } : {}),
    status,
    ok,
    durationMs: Date.now() - started,
    ...(ok ? {} : { error: body }),
    ...(typeof (body as SearchBody | null)?.total === 'number'
      ? {
          total: (body as SearchBody).total,
          returned: (body as SearchBody).itemSummaries?.length ?? 0,
        }
      : {}),
  });
  bodies.set(opts.name, body);

  const results = (body as SearchBody | null)?.itemSummaries?.length;
  const total = (body as SearchBody | null)?.total;
  console.log(
    `  ${ok ? '✓' : '✗'} ${opts.name} — ${status}` +
      (results === undefined ? '' : ` (${results} of ${total ?? '?'})`),
  );
  return body;
}

function searchUrl(params: Record<string, string>): string {
  const url = new URL(`${BROWSE}/item_summary/search`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

type Search = {
  name: string;
  question: string;
  marketplace: string;
  params: Record<string, string>;
};

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');

const searches: Search[] = [
  {
    name: 'gb-baseline',
    question: 'Does Browse search work on EBAY_GB at all, and what does a summary carry?',
    marketplace: 'EBAY_GB',
    params: { q: 'carmageddon', sort: 'newlyListed', limit: '10' },
  },
  {
    name: 'us-baseline',
    question: 'Does the same keyset reach a second marketplace?',
    marketplace: 'EBAY_US',
    params: { q: 'carmageddon', sort: 'newlyListed', limit: '10' },
  },
  {
    name: 'de-baseline',
    question: 'And a third, so the "major sites" preset in §5 is buildable?',
    marketplace: 'EBAY_DE',
    params: { q: 'carmageddon', sort: 'newlyListed', limit: '10' },
  },
  {
    name: 'gb-since-watermark',
    question: 'Does itemStartDate work as the per-plan watermark §6 relies on?',
    marketplace: 'EBAY_GB',
    params: {
      q: 'carmageddon',
      sort: 'newlyListed',
      limit: '10',
      filter: `itemStartDate:[${daysAgo(7)}..]`,
    },
  },
  {
    name: 'gb-since-far-past',
    question: 'How far back can itemStartDate reach? (a cold plan has no watermark)',
    marketplace: 'EBAY_GB',
    params: {
      q: 'carmageddon',
      sort: 'newlyListed',
      limit: '10',
      filter: `itemStartDate:[${daysAgo(120)}..]`,
    },
  },
  {
    name: 'gb-auction-only',
    question: 'buyingOptions filter, for settings.listingTypes',
    marketplace: 'EBAY_GB',
    params: { q: 'carmageddon', sort: 'newlyListed', limit: '10', filter: 'buyingOptions:{AUCTION}' },
  },
  {
    name: 'gb-fixed-only',
    question: 'buyingOptions filter, the other half',
    marketplace: 'EBAY_GB',
    params: {
      q: 'carmageddon',
      sort: 'newlyListed',
      limit: '10',
      filter: 'buyingOptions:{FIXED_PRICE}',
    },
  },
  {
    name: 'gb-price-ceiling',
    question: 'price + priceCurrency filter, for settings.priceCeiling',
    marketplace: 'EBAY_GB',
    params: {
      q: 'carmageddon',
      sort: 'newlyListed',
      limit: '10',
      filter: 'price:[..150],priceCurrency:GBP',
    },
  },
  {
    name: 'gb-location-single',
    question: 'Does itemLocationCountry accept one value?',
    marketplace: 'EBAY_GB',
    params: {
      q: 'carmageddon',
      sort: 'newlyListed',
      limit: '10',
      filter: 'itemLocationCountry:GB',
    },
  },
  {
    name: 'gb-location-us',
    question: 'A second single value, to prove the filter itself works before judging the set form',
    marketplace: 'EBAY_GB',
    params: {
      q: 'carmageddon',
      sort: 'newlyListed',
      limit: '10',
      filter: 'itemLocationCountry:US',
    },
  },
  {
    name: 'gb-location-multi',
    question: 'Does itemLocationCountry accept several? (§4 leaves this open)',
    marketplace: 'EBAY_GB',
    params: {
      q: 'carmageddon',
      sort: 'newlyListed',
      limit: '10',
      filter: 'itemLocationCountry:{GB|US}',
    },
  },
  {
    name: 'gb-broad-macintosh',
    question: 'A broad query, for the worldwide distribution and the pre-filter fixtures',
    marketplace: 'EBAY_GB',
    params: { q: 'macintosh', sort: 'newlyListed', limit: '50' },
  },
  {
    name: 'gb-empty-result',
    question: 'What does an empty result look like? (the harness needs one)',
    marketplace: 'EBAY_GB',
    params: { q: 'zqxjklmnpvwrt nonexistent listing', sort: 'newlyListed', limit: '10' },
  },
  {
    name: 'gb-page-1',
    question: 'Pagination, page one (the harness needs a pagination stop)',
    marketplace: 'EBAY_GB',
    params: { q: 'macintosh', sort: 'newlyListed', limit: '2', offset: '0' },
  },
  {
    name: 'gb-page-2',
    question: 'Pagination, page two',
    marketplace: 'EBAY_GB',
    params: { q: 'macintosh', sort: 'newlyListed', limit: '2', offset: '2' },
  },
];

function keysOf(objects: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const object of objects) for (const key of Object.keys(object)) keys.add(key);
  return [...keys].sort();
}

async function main() {
  const { id, secret } = readCredentials();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'raw'), { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  console.log(`\nS1-01 — eBay Browse spike against ${ENVIRONMENT} (${API})`);
  console.log('\n1. Application token');
  const token = await getToken(id, secret);

  console.log('\n2. Rate limits for this keyset');
  await call(token, {
    name: 'rate-limits',
    question: 'What is the daily quota for Browse on this app?',
    url: `${API}/developer/analytics/v1_beta/rate_limit/?api_name=browse&api_context=buy`,
  });

  console.log('\n3. Searches');
  for (const search of searches) {
    searchProbes.push(search.name);
    await call(token, {
      name: search.name,
      question: search.question,
      url: searchUrl(search.params),
      marketplace: search.marketplace,
    });
  }

  console.log('\n4. getItem');
  // Three items chosen to be different from each other, because the harness needs an auction,
  // a fixed-price listing and something located outside the UK to exercise ships-to-UK.
  const pool = (bodies.get('gb-broad-macintosh') as SearchBody | undefined)?.itemSummaries ?? [];
  const gb = (bodies.get('gb-baseline') as SearchBody | undefined)?.itemSummaries ?? [];
  const all: (Summary & { itemId: string })[] = [...gb, ...pool].filter(
    (item): item is Summary & { itemId: string } => Boolean(item.itemId),
  );
  if (all.length === 0) {
    console.log('  no items from the planned searches — trying generic queries for a getItem target');
    for (const query of ['laptop', 'book', 'phone', 'shirt']) {
      searchProbes.push(`fallback-${query}`);
      const body = (await call(token, {
        name: `fallback-${query}`,
        question: 'Anything at all, so getItem has a target',
        url: searchUrl({ q: query, limit: '5' }),
        marketplace: 'EBAY_GB',
      })) as SearchBody | undefined;
      const found = (body?.itemSummaries ?? []).filter(
        (item): item is Summary & { itemId: string } => Boolean(item.itemId),
      );
      if (found.length > 0) {
        all.push(...found);
        break;
      }
    }
  }

  const picks = [
    all.find((item) => item.buyingOptions?.includes('AUCTION')),
    all.find((item) => item.buyingOptions?.includes('FIXED_PRICE')),
    all.find((item) => item.itemLocation?.country && item.itemLocation.country !== 'GB'),
  ].filter((item, index, list): item is Summary & { itemId: string } =>
    Boolean(item) && list.findIndex((other) => other?.itemId === item?.itemId) === index,
  );
  while (picks.length < 3 && picks.length < all.length) {
    const next = all.find((item) => !picks.some((pick) => pick.itemId === item.itemId));
    if (!next) break;
    picks.push(next);
  }

  const itemNames: string[] = [];
  for (const [index, item] of picks.entries()) {
    const name = `item-${index + 1}`;
    itemNames.push(name);
    await call(token, {
      name,
      question: 'Which fields need getItem rather than the search summary?',
      url: `${BROWSE}/item/${encodeURIComponent(item.itemId)}`,
      marketplace: 'EBAY_GB',
    });
  }

  console.log('\n5. Findings');

  const summaries = searchProbes
    .flatMap((name) => (bodies.get(name) as SearchBody | undefined)?.itemSummaries ?? [])
    .filter((item): item is Summary => Boolean(item));
  const items = itemNames
    .map((name) => bodies.get(name))
    .filter((body): body is Record<string, unknown> => Boolean(body) && typeof body === 'object');

  const summaryKeys = keysOf(summaries as Record<string, unknown>[]);
  const itemKeys = keysOf(items);
  const comparable = summaries.length > 0 && items.length > 0;
  const onlyInItem = comparable ? itemKeys.filter((key) => !summaryKeys.includes(key)) : [];

  // "How does worldwide behave on EBAY_GB without a location filter" is a question about where
  // the results are, so count them.
  const broad = (bodies.get('gb-broad-macintosh') as SearchBody | undefined)?.itemSummaries ?? [];
  const countries: Record<string, number> = {};
  for (const item of broad) {
    const country = item.itemLocation?.country ?? 'unknown';
    countries[country] = (countries[country] ?? 0) + 1;
  }

  const countriesIn = (probe: string): Record<string, number> => {
    const tally: Record<string, number> = {};
    for (const item of (bodies.get(probe) as SearchBody | undefined)?.itemSummaries ?? []) {
      const country = item.itemLocation?.country ?? 'unknown';
      tally[country] = (tally[country] ?? 0) + 1;
    }
    return tally;
  };

  const named = ['image', 'additionalImages', 'itemCreationDate', 'itemLocation', 'shippingOptions'];
  const fieldPresence = Object.fromEntries(
    named.map((field) => [
      field,
      {
        inSearch: summaries.filter((item) => field in item).length,
        ofSearchResults: summaries.length,
        inGetItem: items.filter((item) => field in item).length,
      },
    ]),
  );

  const report = {
    ranAt: new Date().toISOString(),
    environment: ENVIRONMENT,
    apiBase: API,
    answersS1_01: !IS_SANDBOX,
    ranFrom: process.env.SPIKE_ORIGIN ?? 'unset — set SPIKE_ORIGIN=mac|droplet to label this run',
    node: process.version,
    calls,
    findings: {
      browseAccepted: calls.filter((c) => searchProbes.includes(c.name)).every((c) => c.ok),
      rateLimits: {
        status: calls.find((c) => c.name === 'rate-limits')?.status,
        body: bodies.get('rate-limits'),
      },
      marketplacesReached: ['gb-baseline', 'us-baseline', 'de-baseline']
        .map((name) => ({ name, ok: calls.find((c) => c.name === name)?.ok ?? false })),
      // A 400 means the syntax is rejected. A 200 means it parsed — but only the result counts,
      // compared against the unfiltered baseline, show whether it actually filtered.
      itemLocationCountryMultiValue: {
        unfilteredTotal: calls.find((c) => c.name === 'gb-baseline')?.total,
        single: {
          status: calls.find((c) => c.name === 'gb-location-single')?.status,
          total: calls.find((c) => c.name === 'gb-location-single')?.total,
          countries: countriesIn('gb-location-single'),
        },
        singleUs: {
          status: calls.find((c) => c.name === 'gb-location-us')?.status,
          total: calls.find((c) => c.name === 'gb-location-us')?.total,
          countries: countriesIn('gb-location-us'),
        },
        multi: {
          status: calls.find((c) => c.name === 'gb-location-multi')?.status,
          total: calls.find((c) => c.name === 'gb-location-multi')?.total,
          error: calls.find((c) => c.name === 'gb-location-multi')?.error,
          countries: countriesIn('gb-location-multi'),
          // The decisive test. A 200 and a plausible count prove nothing; a result from a
          // country outside the set proves the filter was accepted and then ignored.
          appliedAtAll: Object.keys(countriesIn('gb-location-multi')).every(
            (country) => country === 'GB' || country === 'US',
          ),
        },
      },
      worldwideOnGb: {
        query: 'macintosh',
        results: broad.length,
        countries,
        ...(broad.length === 0
          ? { note: 'no results, so this says nothing about where a real EBAY_GB search reaches' }
          : {}),
      },
      fieldPresence,
      searchKeys: summaryKeys,
      itemKeys,
      onlyInGetItem: comparable
        ? onlyInItem
        : `not computable: ${summaries.length} search results and ${items.length} getItem responses`,
      searchResultsSeen: summaries.length,
    },
  };

  await writeFile(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const [name, body] of bodies) {
    await writeFile(join(OUT, 'raw', `${name}.json`), `${JSON.stringify(body, null, 2)}\n`);
  }

  const anonymiser = createAnonymiser();
  let fixtureCount = 0;
  if (!IS_SANDBOX) {
    for (const [name, body] of bodies) {
      if (name === 'rate-limits') continue;
      const call_ = calls.find((c) => c.name === name);
      if (!call_?.ok) continue;
      await writeFile(
        join(FIXTURES, `${name}.json`),
        `${JSON.stringify(anonymiser.anonymise(body), null, 2)}\n`,
      );
      fixtureCount += 1;
    }
  }

  console.log(`\n  report      → spikes/ebay/out/report.json`);
  console.log(`  raw         → spikes/ebay/out/raw/ (${bodies.size} files, not committed)`);
  console.log(
    IS_SANDBOX
      ? '  fixtures    → none: a sandbox catalogue is synthetic, so it is not recorded'
      : `  fixtures    → packages/sources/ebay/fixtures/ (${fixtureCount} files)`,
  );
  const location = report.findings.itemLocationCountryMultiValue;
  console.log(`\n  Browse accepted every search: ${report.findings.browseAccepted ? 'yes' : 'NO — see report.json'}`);
  console.log(`  search results seen across all probes: ${summaries.length}`);
  console.log(
    `  itemLocationCountry — unfiltered ${location.unfilteredTotal ?? '?'},` +
      ` GB ${location.single.total ?? '?'} ${JSON.stringify(location.single.countries)},` +
      ` US ${location.singleUs.total ?? '?'} ${JSON.stringify(location.singleUs.countries)},` +
      ` {GB|US} ${location.multi.total ?? '?'} ${JSON.stringify(location.multi.countries)}`,
  );
  console.log(
    `  multi-value itemLocationCountry actually filtered: ${
      location.multi.appliedAtAll ? 'yes' : 'NO — accepted and silently ignored'
    }`,
  );
  console.log(`  worldwide on EBAY_GB ("macintosh", ${broad.length} results):`, countries);
  console.log(
    `  only in getItem:`,
    comparable ? onlyInItem.join(', ') || '(none)' : '(not computable — too few results)',
  );
  if (IS_SANDBOX) {
    console.log(
      '\n  This was sandbox. It shows the plumbing works; it answers none of S1-01, whose',
      '\n  questions are all about a production keyset. Re-run with production credentials',
      '\n  and EBAY_ENV=production (or unset) to record the fixtures and tick the boxes.',
    );
  }
}

await main();
