/**
 * Strips the personal data out of an eBay response so it can be committed as a fixture.
 *
 * Seller usernames are pseudonymised rather than deleted, because the adapter's job is to hash
 * the seller and strip the block (§4), and a fixture with no seller block at all could not test
 * that it does. The mapping is stable within one run, so two listings by one seller stay two
 * listings by one seller, which is what relist detection (§7 step 2) matches on.
 */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?<![\w.])(?:\+?\d[\d\s().-]{8,}\d)(?![\w.])/g;

/**
 * Only free prose is scrubbed for contact details. An earlier version walked every string, and
 * the phone pattern ate eBay's own identifiers — `itemId` became `v1|[number removed]|0` and the
 * listing URLs went with it, which quietly ruins a fixture for the adapter tests that key on
 * them. Identifiers, URLs and prices are data; these four fields are the only ones a seller
 * types.
 */
const PROSE_FIELDS = new Set(['description', 'shortDescription', 'conditionDescription', 'title']);

/**
 * `getItem` returns `seller.sellerLegalInfo` for business sellers: the trader's real name, home
 * or business address, email and terms, which UK and EU law makes them publish. It is replaced
 * wholesale rather than scrubbed field by field — the shape is kept so an adapter test can prove
 * the block is stripped before storage, but nothing real survives into a committed fixture.
 */
const SYNTHETIC_LEGAL_INFO = {
  name: 'Example Trading Ltd',
  legalContactFirstName: 'Example',
  legalContactLastName: 'Trader',
  sellerProvidedLegalAddress: {
    addressLine1: '1 Example Street',
    city: 'Exampleton',
    stateOrProvince: 'EX',
    country: 'GB',
    countryName: 'United Kingdom',
  },
  email: 'trader@example.invalid',
  termsOfService: '[terms removed]',
};

export function createAnonymiser() {
  const sellers = new Map<string, string>();

  const pseudonym = (username: string): string => {
    const existing = sellers.get(username);
    if (existing) return existing;
    const next = `seller_${String(sellers.size + 1).padStart(3, '0')}`;
    sellers.set(username, next);
    return next;
  };

  const scrubText = (text: string): string =>
    text.replace(EMAIL, '[email removed]').replace(PHONE, '[number removed]');

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'username' && typeof child === 'string') {
        out[key] = pseudonym(child);
        continue;
      }
      if (PROSE_FIELDS.has(key) && typeof child === 'string') {
        out[key] = scrubText(child);
        continue;
      }
      if (key === 'sellerLegalInfo') {
        out[key] = SYNTHETIC_LEGAL_INFO;
        continue;
      }
      // A partial postcode still narrows a seller to a street, and nothing in the pipeline
      // reads it — country is what §4's `itemLocationCountry` and the ships-to-UK flag use.
      if (key === 'postalCode') continue;
      // Carries the developer account id, and is off by default in the adapter anyway.
      if (key === 'itemAffiliateWebUrl') continue;
      out[key] = walk(child);
    }
    return out;
  };

  return {
    anonymise: <T>(value: T): T => walk(value) as T,
    get sellerCount() {
      return sellers.size;
    },
  };
}
