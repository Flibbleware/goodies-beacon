import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';

/** Shared with the web app (P0-09), so the two agree on what a valid password is. */
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
