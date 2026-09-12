import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret, isEncrypted } from '../crypto.js';
import type { Database } from '../db/client.js';
import { settings } from '../db/schema.js';
import {
  type EmailSettings,
  isEmailConfigured,
  type Settings,
  type SettingsPatch,
  settingsSchema,
} from './schema.js';

/** One row, id 1, enforced by a check constraint on the table. */
const ROW_ID = 1;

/**
 * The stored settings, with defaults filled in for anything never written. The SMTP password is
 * still the stored ciphertext here; `toPublicSettings` is what makes a document safe to send to
 * the browser, and `resolveSmtp` is what decrypts it for the mailer.
 */
export async function readSettings(db: Database): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, ROW_ID));
  return settingsSchema.parse(row?.data ?? {});
}

/**
 * Merges a patch into the stored document one section at a time and returns the result. Merging
 * rather than replacing is what lets the UI save the section in front of the user without having
 * to send back settings it never showed them — and it is how an SMTP password survives a save
 * that did not include it, since the browser is never given it to send back.
 */
export async function writeSettings(
  db: Database,
  patch: SettingsPatch,
  secretKey: string,
): Promise<Settings> {
  const current = await readSettings(db);
  const merged = settingsSchema.parse({
    instance: { ...current.instance, ...defined(patch.instance) },
    email: {
      ...current.email,
      ...defined(patch.email),
      password: nextPassword(current.email.password, patch.email?.password, secretKey),
    },
  });

  await db
    .insert(settings)
    .values({ id: ROW_ID, data: merged })
    .onConflictDoUpdate({ target: settings.id, set: { data: merged, updatedAt: new Date() } });

  return merged;
}

export interface SmtpCredentials {
  readonly host: string;
  readonly port: number;
  readonly security: EmailSettings['security'];
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly notificationAddress: string;
}

/**
 * The SMTP settings with the password decrypted, or undefined if email is not configured yet.
 * The only place the plaintext exists, and only for as long as a send takes.
 */
export function resolveSmtp(settings: Settings, secretKey: string): SmtpCredentials | undefined {
  if (!isEmailConfigured(settings.email)) return undefined;

  const { password, ...rest } = settings.email;
  return { ...rest, password: password === '' ? '' : decryptSecret(password, secretKey) };
}

/**
 * Absent means "not sent, keep what is stored"; empty means "clear it", for a relay that wants no
 * authentication. Anything else is a new password to encrypt. A value that is already an envelope
 * is passed through, so re-saving a document read straight from the database cannot double-encrypt.
 */
function nextPassword(stored: string, submitted: string | undefined, secretKey: string): string {
  if (submitted === undefined) return stored;
  if (submitted === '') return '';
  if (isEncrypted(submitted)) return submitted;
  return encryptSecret(submitted, secretKey);
}

/** An explicit `undefined` in a patch means "not sent", not "back to the default". */
function defined<T extends object>(patch: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
