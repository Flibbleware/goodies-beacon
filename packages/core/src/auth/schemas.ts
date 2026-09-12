import { z } from 'zod';

/**
 * NIST SP 800-63B: eight characters, no composition rules. The maximum only exists because
 * argon2 hashes whatever it is given, and a megabyte-long password would be a cheap way to tie
 * up the process.
 *
 * These live here rather than beside the hashing so that `@goodies-beacon/core/schemas` — which
 * the web app imports — never reaches the native argon2 binding through them.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

/** Shared with the web app, so the two agree on what a valid password is. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const firstRunSchema = z.object({ password: passwordSchema });

/** No length rule on the way in: an existing password is whatever was accepted when it was set. */
export const loginSchema = z.object({ password: z.string().min(1, 'is required') });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'is required'),
  newPassword: passwordSchema,
});

export type FirstRunInput = z.infer<typeof firstRunSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
