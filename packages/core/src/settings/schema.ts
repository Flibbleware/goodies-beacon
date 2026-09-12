import { z } from 'zod';

export const DEFAULT_TIMEZONE = 'Europe/London';
export const DEFAULT_DIGEST_TIME = '08:00';
export const DEFAULT_SMTP_PORT = 587;

/** How the SMTP connection is protected (§10): implicit TLS, STARTTLS, or neither. */
export const SMTP_SECURITIES = ['none', 'starttls', 'tls'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITIES)[number];

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** An IANA zone name. The digest time and every date shown in the UI are read in it. */
const timezone = z
  .string()
  .min(1)
  .refine(isTimeZone, 'must be an IANA time zone, such as Europe/London');

/** 24-hour local time the daily digest is sent (§10). */
const digestTime = z.string().regex(HH_MM, 'must be a 24-hour time such as 08:00');

/** Empty means "not configured yet", which an instance is allowed to be. */
const optionalEmailAddress = z.literal('').or(z.email('must be an email address'));

const port = z.coerce
  .number('must be a port number')
  .int('must be a whole number')
  .min(1, 'must be between 1 and 65535')
  .max(65535, 'must be between 1 and 65535');

export const instanceSettingsSchema = z.object({
  timezone: timezone.default(DEFAULT_TIMEZONE),
  digestTime: digestTime.default(DEFAULT_DIGEST_TIME),
});

export const emailSettingsSchema = z.object({
  host: z.string().default(''),
  port: port.default(DEFAULT_SMTP_PORT),
  security: z.enum(SMTP_SECURITIES).default('starttls'),
  username: z.string().default(''),
  /**
   * Stored as `enc:v1:<ciphertext>` (§12) and never sent to the browser — the API answers with
   * `passwordSet` instead. A patch that leaves it out keeps whatever is stored.
   */
  password: z.string().default(''),
  fromAddress: optionalEmailAddress.default(''),
  notificationAddress: optionalEmailAddress.default(''),
});

/**
 * The whole settings document, stored as one JSONB row. Every field has a default, so an empty
 * row parses into a complete set of settings and a new section needs no migration.
 *
 * Later tasks add sources, AI roles, polling defaults, retention and the budget cap (§14).
 */
export const settingsSchema = z.object({
  instance: instanceSettingsSchema.prefault({}),
  email: emailSettingsSchema.prefault({}),
});

/**
 * The same fields without their defaults. Built separately rather than with `.partial()`, which
 * leaves the defaults in place — so a patch saving one field would silently reset its neighbours
 * to the defaults instead of leaving them alone.
 */
const instancePatchSchema = z.object({
  timezone: timezone.optional(),
  digestTime: digestTime.optional(),
});

const emailPatchSchema = z.object({
  host: z.string().optional(),
  port: port.optional(),
  security: z.enum(SMTP_SECURITIES).optional(),
  username: z.string().optional(),
  /** Absent keeps the stored password; an empty string clears it, for a server with no auth. */
  password: z.string().optional(),
  fromAddress: optionalEmailAddress.optional(),
  notificationAddress: optionalEmailAddress.optional(),
});

/** What a PUT may carry: any subset, so the UI can save one section without sending the rest. */
export const settingsPatchSchema = z.object({
  instance: instancePatchSchema.optional(),
  email: emailPatchSchema.optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

/** Settings as the browser may see them: the SMTP password is replaced by whether there is one. */
export interface PublicSettings {
  instance: Settings['instance'];
  email: Omit<EmailSettings, 'password'> & { passwordSet: boolean };
}

export function toPublicSettings(settings: Settings): PublicSettings {
  const { password, ...email } = settings.email;
  return { instance: settings.instance, email: { ...email, passwordSet: password !== '' } };
}

/** Everything the mailer needs is present, so a test send is worth attempting. */
export function isEmailConfigured(email: EmailSettings | PublicSettings['email']): boolean {
  return email.host !== '' && email.fromAddress !== '' && email.notificationAddress !== '';
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
