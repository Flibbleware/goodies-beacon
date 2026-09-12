import { parseOptions } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { ARGON2_OPTIONS, hashPassword, verifyPassword } from './password.js';

describe('hashPassword', () => {
  it('produces an argon2id hash with the configured cost, which the options cannot state', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(parseOptions(hash)).toMatchObject({
      memoryCost: ARGON2_OPTIONS.memoryCost,
      timeCost: ARGON2_OPTIONS.timeCost,
      parallelism: ARGON2_OPTIONS.parallelism,
    });
  });

  it('salts each hash, so the same password never stores the same value', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('does not contain the password', async () => {
    expect(await hashPassword('sk-plaintext-leak')).not.toContain('sk-plaintext-leak');
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery stapl')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('still verifies a hash made with weaker parameters, so the cost can be raised later', async () => {
    const { hash } = await import('@node-rs/argon2');
    const old = await hash('legacy', { memoryCost: 8192, timeCost: 1, parallelism: 1 });

    expect(await verifyPassword(old, 'legacy')).toBe(true);
    expect(await verifyPassword(old, 'wrong')).toBe(false);
  });
});
