import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SELLER_SALT_BYTES, sellerHash, sellerHashesEqual } from './seller.js';

const SALT = randomBytes(SELLER_SALT_BYTES).toString('base64');
const OTHER_SALT = randomBytes(SELLER_SALT_BYTES).toString('base64');

describe('sellerHash', () => {
  it('is stable, so the same seller matches across polls', () => {
    expect(sellerHash('ebay', 'collector99', SALT)).toBe(sellerHash('ebay', 'collector99', SALT));
  });

  it('separates two sellers, which is what relist detection asks of it', () => {
    expect(sellerHash('ebay', 'collector99', SALT)).not.toBe(
      sellerHash('ebay', 'collector98', SALT),
    );
  });

  it('hashes one seller id differently under two instance salts', () => {
    expect(sellerHash('ebay', 'collector99', SALT)).not.toBe(
      sellerHash('ebay', 'collector99', OTHER_SALT),
    );
  });

  it('separates the same id on two marketplaces, so sellers cannot be correlated across them', () => {
    expect(sellerHash('ebay', 'collector99', SALT)).not.toBe(
      sellerHash('vinted', 'collector99', SALT),
    );
  });

  it('does not leak the seller id into its own output', () => {
    const hash = sellerHash('ebay', 'collector99', SALT);
    expect(hash).not.toContain('collector99');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cannot be forged by moving the boundary between source and seller', () => {
    // `a:bc` and `ab:c` must not collide, or one marketplace could impersonate another.
    expect(sellerHash('ebay', ':collector99', SALT)).not.toBe(
      sellerHash('ebay:', 'collector99', SALT),
    );
  });
});

describe('sellerHashesEqual', () => {
  it('matches identical hashes and rejects different ones', () => {
    const hash = sellerHash('ebay', 'collector99', SALT);
    expect(sellerHashesEqual(hash, hash)).toBe(true);
    expect(sellerHashesEqual(hash, sellerHash('ebay', 'other', SALT))).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    expect(sellerHashesEqual('abc', 'abcd')).toBe(false);
  });
});
