import { hash, verify } from '@node-rs/argon2';

/**
 * OWASP's argon2id floor: 19 MiB of memory, two passes, one lane. Raising these invalidates
 * nothing — the parameters are encoded in each stored hash, so old hashes keep verifying.
 *
 * The algorithm is left to the library, whose default is argon2id; naming it here is not
 * possible because it is an ambient const enum, which verbatimModuleSyntax forbids reading at
 * runtime. `password.test.ts` asserts the hashes really are argon2id with these parameters.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * NIST SP 800-63B: eight characters, no composition rules. The maximum only exists because
 * argon2 hashes whatever it is given, and a megabyte-long password would be a cheap way to
 * tie up the process.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Argon2 recomputes the hash whether or not the password is right, so a wrong one costs the
 * same time as a correct one and reveals nothing by how long it took.
 */
export function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  return verify(storedHash, password, ARGON2_OPTIONS);
}
