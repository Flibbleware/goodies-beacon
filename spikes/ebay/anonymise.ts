/**
 * Turns a live eBay response into a fixture that resolves to nobody.
 *
 * Removing usernames is not enough. A recorded response carries the real `itemId` and listing
 * URL, and anyone can open those and read the seller's name off eBay — so a pseudonymised
 * username is a lock with the key left in it. These fixtures are committed to a repository meant
 * to go public, and an instance claims eBay's "not persisting eBay user data" exemption, so the
 * repository must not become the place that data lives instead. Identifiers are therefore
 * remapped rather than kept, consistently, so the fixtures stay internally coherent — page two
 * still follows page one, an `itemHref` still points at its own `itemId` — while pointing at
 * nothing real.
 */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?<![\w.])(?:\+?\d[\d\s().-]{8,}\d)(?![\w.])/g;

/** Fields a seller writes freely, and the only ones scrubbed for contact details. */
const PROSE_FIELDS = new Set(['description', 'shortDescription', 'conditionDescription']);

/**
 * Dropped outright. `city` and `stateOrProvince` put an individual in a town; the feedback
 * numbers are precise enough to single a seller out. Nothing in the design reads any of them —
 * §4 uses `itemLocationCountry` and nothing else.
 */
const DROP_FIELDS = new Set([
  'city',
  'stateOrProvince',
  'feedbackScore',
  'feedbackPercentage',
  'postalCode',
  'itemAffiliateWebUrl',
]);

/** Replaces a trader's published legal identity, keeping the shape so P1-04 can test it strips it. */
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

/**
 * A seller's own words are their own: one sampled listing volunteered that its seller is a
 * full-time student who ships on Mondays and Thursdays. The adapter only needs a description to
 * be a non-empty HTML string, so it gets one.
 */
const SYNTHETIC_DESCRIPTION =
  '<p>[description replaced for the fixture]</p>' +
  '<p>Boxed PC game. Disc, manual and inserts present. Light shelf wear to the box.</p>';

const IMAGE_HASH = /(i\.ebayimg\.com\/(?:thumbs\/)?images\/g\/)([A-Za-z0-9~_-]+)(\/)/g;

export function createAnonymiser() {
  const sellers = new Map<string, string>();
  const ids = new Map<string, string>();
  const images = new Map<string, string>();

  const pseudonym = (username: string): string => {
    const existing = sellers.get(username);
    if (existing) return existing;
    const next = `seller_${String(sellers.size + 1).padStart(3, '0')}`;
    sellers.set(username, next);
    return next;
  };

  /** Same length, so nothing that measures an id changes behaviour; leading 9 marks it as made up. */
  const fakeId = (real: string): string => {
    const existing = ids.get(real);
    if (existing) return existing;
    const serial = String(ids.size + 1).padStart(Math.max(real.length - 1, 1), '0');
    const next = `9${serial}`.slice(0, real.length);
    ids.set(real, next);
    return next;
  };

  const fakeImage = (real: string): string => {
    const existing = images.get(real);
    if (existing) return existing;
    const next = `Fixture${String(images.size + 1).padStart(3, '0')}`.padEnd(real.length, 'x').slice(
      0,
      real.length,
    );
    images.set(real, next);
    return next;
  };

  const scrubText = (text: string): string =>
    text.replace(EMAIL, '[email removed]').replace(PHONE, '[number removed]');

  /** Every numeric identifier in the document, so the string pass below can replace them all. */
  const collectIds = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) collectIds(child);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const key of ['itemId', 'legacyItemId', 'itemGroupId']) {
      const raw = record[key];
      if (typeof raw === 'string') {
        for (const part of raw.split('|')) if (/^\d{6,}$/.test(part)) fakeId(part);
      }
    }
    for (const child of Object.values(record)) collectIds(child);
  };

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_FIELDS.has(key)) continue;
      if (key === 'username' && typeof child === 'string') {
        out[key] = pseudonym(child);
        continue;
      }
      if (key === 'sellerLegalInfo') {
        out[key] = SYNTHETIC_LEGAL_INFO;
        continue;
      }
      if (key === 'description' && typeof child === 'string') {
        out[key] = SYNTHETIC_DESCRIPTION;
        continue;
      }
      if (key === 'shortDescription' && typeof child === 'string') {
        out[key] = 'Boxed PC game, disc and manual included.';
        continue;
      }
      if (key === 'itemGroupTitle' && typeof child === 'string') {
        out[key] = 'Example listing group';
        continue;
      }
      // Carries tracking blobs (`amdata`) and the search terms; the path is what identifies it.
      if ((key === 'itemWebUrl' || key === 'itemGroupHref') && typeof child === 'string') {
        out[key] = child.split('?')[0];
        continue;
      }
      if (PROSE_FIELDS.has(key) && typeof child === 'string') {
        out[key] = scrubText(child);
        continue;
      }
      out[key] = walk(child);
    }
    return out;
  };

  return {
    anonymise: <T>(value: T): T => {
      collectIds(value);
      let json = JSON.stringify(walk(value));
      // A string pass, because an id also appears inside itemHref, itemWebUrl and next/prev,
      // percent-encoded or not, and every copy has to move together or the fixture stops cohering.
      for (const [real, fake] of ids) json = json.split(real).join(fake);
      json = json.replace(IMAGE_HASH, (_m, prefix, hash, suffix) => prefix + fakeImage(hash) + suffix);
      return JSON.parse(json) as T;
    },
    get counts() {
      return { sellers: sellers.size, ids: ids.size, images: images.size };
    },
  };
}
