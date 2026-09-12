import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  firstRunSchema,
  loginSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './schemas.js';

const MIN = 'x'.repeat(PASSWORD_MIN_LENGTH);

describe('firstRunSchema', () => {
  it('requires a new password of at least the minimum length', () => {
    expect(firstRunSchema.safeParse({ password: MIN }).success).toBe(true);
    expect(firstRunSchema.safeParse({ password: MIN.slice(1) }).success).toBe(false);
  });

  it('refuses a password long enough to be a way of tying up the process', () => {
    expect(firstRunSchema.safeParse({ password: 'x'.repeat(PASSWORD_MAX_LENGTH) }).success).toBe(
      true,
    );
    expect(
      firstRunSchema.safeParse({ password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });
});

describe('loginSchema', () => {
  it('does not impose a length on an existing password', () => {
    expect(loginSchema.safeParse({ password: 'short' }).success).toBe(true);
    expect(loginSchema.safeParse({ password: '' }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('requires both passwords, and the new one to meet the minimum', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: MIN }).success,
    ).toBe(true);
    expect(changePasswordSchema.safeParse({ newPassword: MIN }).success).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    ).toBe(false);
  });
});
