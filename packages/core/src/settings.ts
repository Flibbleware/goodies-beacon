import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './db/client.js';
import { settings } from './db/schema.js';

/** One row, id 1, enforced by a check constraint on the table. */
const ROW_ID = 1;

export const DEFAULT_TIMEZONE = 'Europe/London';
export const DEFAULT_DIGEST_TIME = '08:00';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** An IANA zone name. The digest time and every date shown in the UI are read in it. */
const timezone = z
  .string()
  .min(1)
  .refine(isTimeZone, 'must be an IANA time zone, such as Europe/London');

/** 24-hour local time the daily digest is sent (§10). */
const digestTime = z.string().regex(HH_MM, 'must be a 24-hour time such as 08:00');

export const instanceSettingsSchema = z.object({
  timezone: timezone.default(DEFAULT_TIMEZONE),
  digestTime: digestTime.default(DEFAULT_DIGEST_TIME),
});

/**
 * The same fields without their defaults. Built separately rather than with `.partial()`, which
 * leaves the defaults in place — so a patch saving one field would silently reset its neighbours
 * to the defaults instead of leaving them alone.
 */
const instanceSettingsPatchSchema = z.object({
  timezone: timezone.optional(),
  digestTime: digestTime.optional(),
});

/**
 * The whole settings document, stored as one JSONB row. Every field has a default, so an empty
 * row parses into a complete set of settings and a new section needs no migration.
 *
 * P0-10 adds the `email` section and the account password change; later tasks add sources, AI
 * roles, polling defaults, retention and the budget cap (§14).
 */
export const settingsSchema = z.object({
  instance: instanceSettingsSchema.prefault({}),
});

/** What a PUT may carry: any subset, so the UI can save one section without sending the rest. */
export const settingsPatchSchema = z.object({
  instance: instanceSettingsPatchSchema.optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** The stored settings, with defaults filled in for anything never written. */
export async function readSettings(db: Database): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, ROW_ID));
  return settingsSchema.parse(row?.data ?? {});
}

/**
 * Merges a patch into the stored document one section at a time and returns the result. Merging
 * rather than replacing is what lets the UI save the section in front of the user without
 * having to send back settings it never showed them.
 */
export async function writeSettings(db: Database, patch: SettingsPatch): Promise<Settings> {
  const current = await readSettings(db);
  const merged = settingsSchema.parse({
    ...current,
    instance: { ...current.instance, ...defined(patch.instance) },
  });

  await db
    .insert(settings)
    .values({ id: ROW_ID, data: merged })
    .onConflictDoUpdate({
      target: settings.id,
      set: { data: merged, updatedAt: new Date() },
    });

  return merged;
}

/** An explicit `undefined` in a patch means "not sent", not "back to the default". */
function defined<T extends object>(patch: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
