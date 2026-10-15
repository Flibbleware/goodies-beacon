/**
 * Records `getItem` for listings in each availability state, as P1-38's fixtures (docs/SPIKES.md,
 * *Is it still for sale?*). Pass item ids found by watching auctions end:
 *
 *   node spikes/ebay/availability.ts sold=<id> ended=<id> multi-quantity=<id>
 *
 * Each is written to packages/sources/ebay/fixtures/item-<name>.json, through the same anonymiser
 * as the search fixtures.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAnonymiser } from './anonymise.ts';

const REPO = join(import.meta.dirname, '..', '..');
const FIXTURES = join(REPO, 'packages', 'sources', 'ebay', 'fixtures');
const API = 'https://api.ebay.com';

try {
  process.loadEnvFile(join(REPO, '.env'));
} catch {
  // Already exported, or no .env; the check below reports it either way.
}
const id = process.env.EBAY_CLIENT_ID;
const secret = process.env.EBAY_CLIENT_SECRET;
if (!id || !secret) {
  console.error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set; see spikes/README.md.');
  process.exit(1);
}

const wanted = process.argv.slice(2).map((arg) => arg.split('=') as [string, string]);
if (wanted.length === 0 || wanted.some(([name, itemId]) => !name || !itemId)) {
  console.error('usage: node spikes/ebay/availability.ts <name>=<item id> …');
  process.exit(1);
}

const token = (await (
  await fetch(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  })
).json()) as { access_token: string };

const anonymiser = createAnonymiser({ idPrefix: '8' });
for (const [name, itemId] of wanted) {
  const response = await fetch(`${API}/buy/browse/v1/item/${encodeURIComponent(itemId)}`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    },
  });
  const body = await response.json();
  const file = join(FIXTURES, `item-${name}.json`);
  await writeFile(file, `${JSON.stringify(anonymiser.anonymise(body), null, 2)}\n`);
  console.log(`  ${name} → ${response.status} → ${file}`);
}
