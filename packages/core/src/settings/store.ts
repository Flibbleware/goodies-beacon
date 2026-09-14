import { eq } from 'drizzle-orm';
import type { AiKeys } from '../config.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Database } from '../db/client.js';
import { settings } from '../db/schema.js';
import {
  AI_PROVIDERS,
  type AiProvider,
  type EmailSettings,
  isEbayConfigured,
  isEmailConfigured,
  providerCredential,
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
    polling: { ...current.polling, ...defined(patch.polling) },
    ai: {
      ...current.ai,
      ...defined(patch.ai),
      roles: { ...current.ai.roles, ...defined(patch.ai?.roles) },
      // Each key follows the SMTP password's rule: absent keeps it, empty clears it.
      anthropic: {
        apiKey: nextPassword(current.ai.anthropic.apiKey, patch.ai?.anthropic?.apiKey, secretKey),
      },
      openai: {
        apiKey: nextPassword(current.ai.openai.apiKey, patch.ai?.openai?.apiKey, secretKey),
      },
      google: {
        apiKey: nextPassword(current.ai.google.apiKey, patch.ai?.google?.apiKey, secretKey),
      },
      openrouter: {
        apiKey: nextPassword(current.ai.openrouter.apiKey, patch.ai?.openrouter?.apiKey, secretKey),
      },
      // A base URL is not a secret and is stored as typed, so it can be shown back.
      ollama: { baseUrl: patch.ai?.ollama?.baseUrl ?? current.ai.ollama.baseUrl },
    },
    email: {
      ...current.email,
      ...defined(patch.email),
      password: nextPassword(current.email.password, patch.email?.password, secretKey),
    },
    sources: {
      ebay: {
        ...current.sources.ebay,
        ...defined(patch.sources?.ebay),
        // Both follow the SMTP password's rule: absent keeps what is stored, empty clears it.
        clientSecret: nextPassword(
          current.sources.ebay.clientSecret,
          patch.sources?.ebay?.clientSecret,
          secretKey,
        ),
        proxyUrl: nextPassword(
          current.sources.ebay.proxyUrl,
          patch.sources?.ebay?.proxyUrl,
          secretKey,
        ),
      },
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

export interface EbayCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Empty when no proxy is configured, which means go direct. */
  readonly proxyUrl: string;
}

/**
 * The eBay keyset with its secrets decrypted, or undefined if it is not configured. The only
 * place the plaintext exists, and only for as long as a poll takes.
 */
export function resolveEbay(settings: Settings, secretKey: string): EbayCredentials | undefined {
  const ebay = settings.sources.ebay;
  if (!isEbayConfigured(ebay)) return undefined;

  return {
    clientId: ebay.clientId,
    clientSecret: decryptSecret(ebay.clientSecret, secretKey),
    proxyUrl: ebay.proxyUrl === '' ? '' : decryptSecret(ebay.proxyUrl, secretKey),
  };
}

/**
 * Absent means "not sent, keep what is stored"; empty means "clear it", for a relay that wants no
 * authentication. Anything else is a new password and is encrypted as it is — even something that
 * looks like a stored envelope, since the browser is never given one to send back and a value
 * stored unencrypted would only fail to decrypt later.
 */
function nextPassword(stored: string, submitted: string | undefined, secretKey: string): string {
  if (submitted === undefined) return stored;
  if (submitted === '') return '';
  return encryptSecret(submitted, secretKey);
}

/** An explicit `undefined` in a patch means "not sent", not "back to the default". */
function defined<T extends object>(patch: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * The credential for one AI provider, decrypted, or undefined if there is none.
 *
 * §12 allows either source, and Settings wins: it is the specific, visible place someone put a
 * key, while `.env` is the instance-wide fallback an operator set once. Ollama's "credential" is
 * a base URL rather than a secret, so it is read as typed.
 */
export function resolveAiProvider(
  settings: Settings,
  provider: AiProvider,
  secretKey: string,
  env?: AiKeys,
): string | undefined {
  const stored = providerCredential(settings.ai, provider);
  if (stored !== '') {
    return provider === 'ollama' ? stored : decryptSecret(stored, secretKey);
  }
  return envCredential(provider, env) ?? undefined;
}

/** Which providers `.env` supplies, so the UI can say a provider is configured without one here. */
export function aiProvidersFromEnv(env?: AiKeys): Set<AiProvider> {
  return new Set(AI_PROVIDERS.filter((provider) => envCredential(provider, env)));
}

function envCredential(provider: AiProvider, env?: AiKeys): string | undefined {
  if (!env) return undefined;
  switch (provider) {
    case 'anthropic':
      return env.anthropicApiKey;
    case 'openai':
      return env.openaiApiKey;
    case 'google':
      return env.googleGenerativeAiApiKey;
    case 'openrouter':
      return env.openrouterApiKey;
    case 'ollama':
      return env.ollamaBaseUrl;
  }
}
