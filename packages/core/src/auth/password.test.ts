import { parseOptions } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import {
  ARGON2_OPTIONS,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from './password.js';
import { changePasswordSchema, firstRunSchema, loginSchema } from './schemas.js';

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

describe('auth schemas', () => {
  it('requires a new password of at least the minimum length', () => {
    expect(firstRunSchema.safeParse({ password: 'x'.repeat(PASSWORD_MIN_LENGTH) }).success).toBe(
      true,
    );
    expect(
      firstRunSchema.safeParse({ password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) }).success,
    ).toBe(false);
    expect(
      firstRunSchema.safeParse({ password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('does not impose a length on an existing password at login', () => {
    expect(loginSchema.safeParse({ password: 'short' }).success).toBe(true);
    expect(loginSchema.safeParse({ password: '' }).success).toBe(false);
  });

  it('requires both passwords to change one', () => {
    const valid = { currentPassword: 'old', newPassword: 'x'.repeat(PASSWORD_MIN_LENGTH) };
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
    expect(changePasswordSchema.safeParse({ newPassword: valid.newPassword }).success).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    ).toBe(false);
  });
});
