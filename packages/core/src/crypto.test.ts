import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  decryptSecret,
  encryptSecret,
  isEncrypted,
  secretsEqual,
} from './crypto.js';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', () => {
    const encrypted = encryptSecret('smtp-password', KEY_A);
    expect(decryptSecret(encrypted, KEY_A)).toBe('smtp-password');
  });

  it('produces the documented enc:v1: envelope and hides the plaintext', () => {
    const encrypted = encryptSecret('sk-ant-secret', KEY_A);

    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toContain('sk-ant-secret');
  });

  it('uses a fresh iv, so the same plaintext never encrypts to the same value', () => {
    expect(encryptSecret('same', KEY_A)).not.toBe(encryptSecret('same', KEY_A));
  });

  it('round-trips unicode and empty strings', () => {
    for (const value of ['', 'ポケモン 1500円', 'a'.repeat(5000)]) {
      expect(decryptSecret(encryptSecret(value, KEY_A), KEY_A)).toBe(value);
    }
  });

  it('refuses the wrong key rather than returning rubbish', () => {
    const encrypted = encryptSecret('smtp-password', KEY_A);

    expect(() => decryptSecret(encrypted, KEY_B)).toThrow(DecryptionError);
    expect(() => decryptSecret(encrypted, KEY_B)).toThrow(/does not match/);
  });

  it('detects a tampered ciphertext', () => {
    const encrypted = encryptSecret('smtp-password', KEY_A);
    const payload = Buffer.from(encrypted.slice('enc:v1:'.length), 'base64');
    payload[payload.length - 1] ^= 0xff;
    const tampered = `enc:v1:${payload.toString('base64')}`;

    expect(() => decryptSecret(tampered, KEY_A)).toThrow(DecryptionError);
  });

  it('rejects a value that was never encrypted', () => {
    expect(isEncrypted('plaintext')).toBe(false);
    expect(() => decryptSecret('plaintext', KEY_A)).toThrow(/not an encrypted secret/);
  });

  it('rejects a truncated payload', () => {
    expect(() => decryptSecret('enc:v1:AAAA', KEY_A)).toThrow(/truncated/);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptSecret('x', Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('secretsEqual', () => {
  it('compares equal and unequal values, including different lengths', () => {
    expect(secretsEqual('abc', 'abc')).toBe(true);
    expect(secretsEqual('abc', 'abd')).toBe(false);
    expect(secretsEqual('abc', 'abcd')).toBe(false);
  });
});
