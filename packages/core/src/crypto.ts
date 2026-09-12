import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Settings-entered secrets are stored as `enc:v1:<base64>` where the payload is
 * iv (12 bytes) ‖ auth tag (16 bytes) ‖ ciphertext, encrypted with AES-256-GCM
 * under GOODIES_BEACON_SECRET_KEY (§12).
 */
const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class DecryptionError extends Error {
  override readonly name = 'DecryptionError';
}

/** True for a value produced by `encryptSecret`, so a plaintext migration can be detected. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string, secretKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secretKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * Reverse of `encryptSecret`. Throws DecryptionError for the wrong key or tampered
 * ciphertext — GCM authenticates, so a wrong key cannot silently return rubbish.
 */
export function decryptSecret(value: string, secretKey: string): string {
  if (!isEncrypted(value)) {
    throw new DecryptionError('value is not an encrypted secret (missing the enc:v1: prefix)');
  }

  const payload = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new DecryptionError('encrypted secret is truncated');
  }

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secretKey), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError(
      'could not decrypt: GOODIES_BEACON_SECRET_KEY does not match the key this value was encrypted with, or the value has been altered',
    );
  }
}

/** Constant-time comparison, for callers checking a re-encrypted value against a stored one. */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function keyBytes(secretKey: string): Buffer {
  const key = Buffer.from(secretKey, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new DecryptionError(
      `GOODIES_BEACON_SECRET_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}
