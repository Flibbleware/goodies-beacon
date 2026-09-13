/**
 * A live run of the adapter against a real keyset (P1-04's "a live run from the dev environment
 * returns real Carmageddon listings").
 *
 * Not a test: it spends quota and needs credentials, so it is a script you run deliberately.
 * Everything else about the adapter is covered offline by the fixture harness.
 *
 *   node packages/sources/ebay/scripts/live-check.ts
 */

import { createHttpClient, createMemoryCookieJar, createSilentLogger } from '@goodies-beacon/core';
import { ebayAdapter } from '../src/index.js';

const repoRoot = new URL('../../../../.env', import.meta.url);
try {
  process.loadEnvFile(repoRoot);
} catch {
  // Already exported, or no .env; the check below reports it either way.
}

const clientId = process.env.EBAY_CLIENT_ID;
const clientSecret = process.env.EBAY_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set; see spikes/README.md.');
  process.exit(1);
}

const http = createHttpClient({ concurrency: 1, userAgent: 'goodies-beacon/0.2 (live-check)' });
const ctx = {
  source: 'ebay' as const,
  http,
  cookies: createMemoryCookieJar(),
  browser: null,
  logger: createSilentLogger(),
  credentials: { clientId, clientSecret, sellerSalt: 'live-check-salt' },
};

const plan = {
  id: 'live-check',
  source: 'ebay' as const,
  query: 'carmageddon',
  region: 'EBAY_GB',
  options: {},
  enabled: true,
  watermark: null,
};

console.log('health check…');
const health = await ebayAdapter.healthCheck(ctx);
console.log(`  ${health.status}: ${health.message}`);
if (health.status === 'error') process.exit(1);

console.log('\nsearch EBAY_GB "carmageddon", newest 5…');
const listings = await ebayAdapter.search(plan, { since: null, mode: 'poll', cap: 5 }, ctx);
for (const listing of listings) {
  const price =
    listing.priceAmount === null ? 'no price' : `${listing.priceAmount} ${listing.priceCurrency}`;
  console.log(
    `  ${listing.buyingType?.padEnd(7)} ${price.padEnd(12)} ${listing.title.slice(0, 60)}`,
  );
}

const first = listings[0];
if (!first) {
  console.error('\nno listings returned — nothing to enrich');
  process.exit(1);
}

console.log(`\nenrich ${first.externalId}…`);
const enriched = await ebayAdapter.enrich(first, ctx);
console.log(
  `  description: ${enriched.description ? `${enriched.description.length} chars` : 'none'}`,
);
console.log(`  images:      ${enriched.images.length}`);
console.log(`  ships to UK: ${enriched.shipsToUk}`);
console.log(`  seller hash: ${enriched.sellerHash?.slice(0, 16)}…`);
console.log(`  raw has seller block: ${Object.hasOwn(enriched.raw, 'seller')}`);

await http.close();
