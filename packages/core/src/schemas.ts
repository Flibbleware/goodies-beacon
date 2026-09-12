/**
 * @goodies-beacon/core/schemas — the validation the API and the web app must agree on.
 *
 * A separate entry point from the package root because the web app runs in a browser: the root
 * barrel reaches Postgres, pg-boss, pino and the native argon2 binding, none of which can be
 * bundled. Nothing imported from here may depend on those, and `schemas.test.ts` proves it.
 */
export {
  type ChangePasswordInput,
  changePasswordSchema,
  type FirstRunInput,
  firstRunSchema,
  type LoginInput,
  loginSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
} from './auth/schemas.js';
export {
  DEFAULT_DIGEST_TIME,
  DEFAULT_SMTP_PORT,
  DEFAULT_TIMEZONE,
  type EmailSettings,
  emailSettingsSchema,
  instanceSettingsSchema,
  isEmailConfigured,
  type PublicSettings,
  type Settings,
  type SettingsPatch,
  SMTP_SECURITIES,
  type SmtpSecurity,
  settingsPatchSchema,
  settingsSchema,
  toPublicSettings,
} from './settings/schema.js';
