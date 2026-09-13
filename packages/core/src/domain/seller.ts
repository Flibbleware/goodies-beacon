import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Database } from '../db/client.js';
import { instanceSecret } from '../db/schema.js';

/**
 * Seller identity, reduced to something that answers one question and no others.
 *
 * ARCHITECTURE.md §4: no marketplace user data is persisted. Relist detection (§7 step 2) only
 * ever asks "is this the same seller as that earlier candidate", which is an equality test, so a
 * keyed hash serves it exactly as well as a username would while leaving nothing to leak.
 *
 * It is an HMAC rather than a plain hash because seller ids are guessable: eBay usernames are
 * short and enumerable, so `sha256(username)` would be reversible by anyone willing to hash a
 * wordlist. The key makes that useless without the salt, and the salt is stored encrypted.
 */

export const SELLER_SALT_BYTES = 32;

/**
 * Distinct per source, so one seller id cannot be correlated across marketplaces.
 *
 * The source is length-prefixed rather than merely delimited: `('ebay', ':bob')` and
 * `('ebay:', 'bob')` both render as `ebay::bob` under a plain separator and collide. No current
 * SourceId contains a colon, so this is theory today — but the encoding should not be the thing
 * standing between a future source id and a wrong match.
 */
export function sellerHash(source: string, sellerId: string, salt: string): string {
  return createHmac('sha256', salt).update(`${source.length}:${source}:${sellerId}`).digest('hex');
}

/** Constant-time, because a hash comparison in the relist path is attacker-influenced. */
export function sellerHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The instance's salt, generated on first use and stored encrypted under the master key.
 *
 * Deliberately not derived from `GOODIES_BEACON_SECRET_KEY`: rotating that key is the documented
 * remedy if it leaks, and a derived salt would change with it, silently orphaning every hash
 * already written and breaking relist detection with nothing to notice. Held in a row instead,
 * rotation re-wraps this one value and the hashes keep matching.
 */
export async function loadSellerSalt(db: Database, secretKey: string): Promise<string> {
  const [existing] = await db
    .select({ sellerSalt: instanceSecret.sellerSalt })
    .from(instanceSecret)
    .where(eq(instanceSecret.id, 1))
    .limit(1);

  if (existing) return decryptSecret(existing.sellerSalt, secretKey);

  const salt = randomBytes(SELLER_SALT_BYTES).toString('base64');
  // Two workers can reach this at once on a fresh instance; the first writes and the rest read
  // what it wrote, so the salt is decided once rather than per process.
  const [inserted] = await db
    .insert(instanceSecret)
    .values({ id: 1, sellerSalt: encryptSecret(salt, secretKey) })
    .onConflictDoNothing()
    .returning({ sellerSalt: instanceSecret.sellerSalt });

  if (inserted) return salt;

  const [raced] = await db
    .select({ sellerSalt: instanceSecret.sellerSalt })
    .from(instanceSecret)
    .where(eq(instanceSecret.id, 1))
    .limit(1);
  if (!raced) throw new Error('seller salt row vanished between insert and read');
  return decryptSecret(raced.sellerSalt, secretKey);
}
