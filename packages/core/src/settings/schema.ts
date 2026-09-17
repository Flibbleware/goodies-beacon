import { z } from 'zod';
import { type AI_ROLES, IMAGE_STRATEGIES } from '../domain/constants.js';
import { durationSchema, priceCeilingSchema } from '../domain/spec.js';

export const DEFAULT_TIMEZONE = 'Europe/London';
export const DEFAULT_DIGEST_TIME = '08:00';
export const DEFAULT_SMTP_PORT = 587;

/** Three times a day (§6), used by any item whose own `pollEvery` is null. */
export const DEFAULT_POLL_INTERVAL = 'PT8H';

/**
 * The §6 safety valves, as counts of new listings one run may take.
 *
 * A routine poll stops at 50 so a query like "game" cannot queue hundreds of reviews from a
 * single run; a backfill or a "Scan current listings" is a deliberate, one-off sweep and is
 * allowed 200. Neither loses the remainder: a run that stops at the cap records where it got to
 * and the next one carries on from there.
 */
export const DEFAULT_POLL_CAP = 50;
export const DEFAULT_BACKFILL_CAP = 200;

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

export const pollingSettingsSchema = z.object({
  /** ISO 8601; the scheduler still refuses to run faster than a source's own minimum (§5). */
  defaultInterval: durationSchema.default(DEFAULT_POLL_INTERVAL),
  pollCap: z.coerce.number().int().min(1).max(1000).default(DEFAULT_POLL_CAP),
  backfillCap: z.coerce.number().int().min(1).max(1000).default(DEFAULT_BACKFILL_CAP),
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
 * The providers Goodies Beacon can reach (§9). Anthropic, OpenAI and Google are first party;
 * OpenRouter reaches many providers through one account and Ollama runs a model locally, and
 * both speak the OpenAI wire format, so one compatible client serves them.
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter', 'ollama'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * `provider:model`, split on the *first* colon only — an Ollama model is itself `name:tag`
 * (`llama3.1:8b`), so splitting on every colon would lose the tag.
 */
const MODEL_REF = new RegExp(`^(${AI_PROVIDERS.join('|')}):.+$`);

export const modelRefSchema = z
  .string()
  .regex(MODEL_REF, `must be provider:model, where provider is one of ${AI_PROVIDERS.join(', ')}`);

/**
 * Defaults chosen per §9's tiers from the September 2026 price table: the interviewer is a
 * conversation with tool use and is worth a strong model, the pre-filter runs on everything and
 * must be the cheapest thing that can read, and the reviewer needs vision and structured output
 * in the middle. Every one is a Settings change away from something else.
 */
export const DEFAULT_AI_ROLES: Record<(typeof AI_ROLES)[number], string> = {
  interviewer: 'anthropic:claude-opus-5',
  /**
   * Not `openai:gpt-5-nano`, which it was until P1-17 measured it: across twelve runs of the
   * prompt evaluation it discarded a water-damaged but genuine listing in four of them, reasoning
   * that a missing manual made it "not the complete big-box set". That is a completeness
   * judgement, which §7 step 3 tells this stage in as many words not to make, and a wrongly
   * discarded listing is never reviewed, never emailed and never noticed. `gemini-3.5-flash-lite`
   * did not do it once, at the same cost per call.
   *
   * It does mean the defaults now name three providers. Every role is independently configurable
   * (§9), so anyone minding that changes one line in Settings — but the default has to be a model
   * that does the job, and a third of runs losing the listing the collector might have wanted is
   * not doing the job.
   */
  prefilter: 'google:gemini-3.5-flash-lite',
  reviewer: 'openai:gpt-5-mini',
};

const providerKeySchema = z.object({
  /** `enc:v1:` at rest like every other secret (§12); never sent to the browser. */
  apiKey: z.string().default(''),
});

export const aiSettingsSchema = z.object({
  roles: z
    .object({
      interviewer: modelRefSchema.default(DEFAULT_AI_ROLES.interviewer),
      prefilter: modelRefSchema.default(DEFAULT_AI_ROLES.prefilter),
      reviewer: modelRefSchema.default(DEFAULT_AI_ROLES.reviewer),
    })
    .prefault({}),
  anthropic: providerKeySchema.prefault({}),
  openai: providerKeySchema.prefault({}),
  google: providerKeySchema.prefault({}),
  openrouter: providerKeySchema.prefault({}),
  /** Ollama is a local server rather than a key: a base URL, and no secret to hide. */
  ollama: z.object({ baseUrl: z.string().default('') }).prefault({}),
  /** Null means no cap. GBP, like every other money field the user types (§4). */
  monthlyBudget: priceCeilingSchema.nullable().default(null),
  imageStrategy: z.enum(IMAGE_STRATEGIES).default('separate'),
});

/**
 * Per-source credentials and proxy (§5). Both secrets are stored as `enc:v1:` like the SMTP
 * password and never sent to the browser — a proxy URL carries `user:pass@host` and is as much a
 * credential as the keyset is.
 */
export const ebaySourceSchema = z.object({
  /** The App ID (Client ID) from a production keyset. */
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  /** `http://user:pass@host:port` or a SOCKS5 URL. Empty means go direct. */
  proxyUrl: z.string().default(''),
});

export const sourcesSettingsSchema = z.object({
  ebay: ebaySourceSchema.prefault({}),
});

/**
 * The whole settings document, stored as one JSONB row. Every field has a default, so an empty
 * row parses into a complete set of settings and a new section needs no migration.
 *
 * Later tasks add AI roles, retention and the budget cap (§14).
 */
export const settingsSchema = z.object({
  instance: instanceSettingsSchema.prefault({}),
  polling: pollingSettingsSchema.prefault({}),
  ai: aiSettingsSchema.prefault({}),
  email: emailSettingsSchema.prefault({}),
  sources: sourcesSettingsSchema.prefault({}),
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

const pollingPatchSchema = z.object({
  defaultInterval: durationSchema.optional(),
  pollCap: z.coerce.number().int().min(1).max(1000).optional(),
  backfillCap: z.coerce.number().int().min(1).max(1000).optional(),
});

const aiPatchSchema = z.object({
  roles: z
    .object({
      interviewer: modelRefSchema.optional(),
      prefilter: modelRefSchema.optional(),
      reviewer: modelRefSchema.optional(),
    })
    .optional(),
  // Each follows the SMTP password's rule: absent keeps what is stored, empty clears it.
  anthropic: z.object({ apiKey: z.string().optional() }).optional(),
  openai: z.object({ apiKey: z.string().optional() }).optional(),
  google: z.object({ apiKey: z.string().optional() }).optional(),
  openrouter: z.object({ apiKey: z.string().optional() }).optional(),
  ollama: z.object({ baseUrl: z.string().optional() }).optional(),
  monthlyBudget: priceCeilingSchema.nullable().optional(),
  imageStrategy: z.enum(IMAGE_STRATEGIES).optional(),
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

const ebaySourcePatchSchema = z.object({
  clientId: z.string().optional(),
  /** Absent keeps what is stored; an empty string clears it. Same rule as the SMTP password. */
  clientSecret: z.string().optional(),
  proxyUrl: z.string().optional(),
});

/** What a PUT may carry: any subset, so the UI can save one section without sending the rest. */
export const settingsPatchSchema = z.object({
  instance: instancePatchSchema.optional(),
  polling: pollingPatchSchema.optional(),
  ai: aiPatchSchema.optional(),
  email: emailPatchSchema.optional(),
  sources: z.object({ ebay: ebaySourcePatchSchema.optional() }).optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type EmailSettings = z.infer<typeof emailSettingsSchema>;
export type PollingSettings = z.infer<typeof pollingSettingsSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type SourcesSettings = z.infer<typeof sourcesSettingsSchema>;
export type EbaySourceSettings = z.infer<typeof ebaySourceSchema>;

/** Settings as the browser may see them: every secret is replaced by whether there is one. */
/** One provider as the browser may see it: whether there is a key, never the key. */
export interface PublicProvider {
  configured: boolean;
}

export interface PublicSettings {
  instance: Settings['instance'];
  polling: Settings['polling'];
  ai: {
    roles: AiSettings['roles'];
    monthlyBudget: AiSettings['monthlyBudget'];
    imageStrategy: AiSettings['imageStrategy'];
    /** Includes keys supplied through .env, which Settings can override but never displays. */
    providers: Record<AiProvider, PublicProvider>;
  };
  email: Omit<EmailSettings, 'password'> & { passwordSet: boolean };
  sources: {
    ebay: Omit<EbaySourceSettings, 'clientSecret' | 'proxyUrl'> & {
      clientSecretSet: boolean;
      proxySet: boolean;
    };
  };
}

/**
 * `fromEnv` says which providers `.env` already supplies a key for, so the UI can show "set in
 * the environment" rather than an empty box beside a provider that is, in fact, working (§12
 * allows either source). It is a set of names; no value from it reaches the browser.
 */
export function toPublicSettings(
  settings: Settings,
  fromEnv: ReadonlySet<AiProvider> = new Set(),
): PublicSettings {
  const { password, ...email } = settings.email;
  const { clientSecret, proxyUrl, ...ebay } = settings.sources.ebay;

  const providers = Object.fromEntries(
    AI_PROVIDERS.map((provider) => [
      provider,
      { configured: providerCredential(settings.ai, provider) !== '' || fromEnv.has(provider) },
    ]),
  ) as Record<AiProvider, PublicProvider>;

  return {
    instance: settings.instance,
    polling: settings.polling,
    ai: {
      roles: settings.ai.roles,
      monthlyBudget: settings.ai.monthlyBudget,
      imageStrategy: settings.ai.imageStrategy,
      providers,
    },
    email: { ...email, passwordSet: password !== '' },
    sources: {
      ebay: { ...ebay, clientSecretSet: clientSecret !== '', proxySet: proxyUrl !== '' },
    },
  };
}

/** The stored credential for a provider, still encrypted. Ollama's is a URL, not a secret. */
export function providerCredential(ai: AiSettings, provider: AiProvider): string {
  return provider === 'ollama' ? ai.ollama.baseUrl : ai[provider].apiKey;
}

/** Splits `provider:model` on the first colon only, so an Ollama `name:tag` survives. */
export function parseModelRef(ref: string): { provider: AiProvider; model: string } | undefined {
  const separator = ref.indexOf(':');
  if (separator < 1) return undefined;

  const provider = ref.slice(0, separator);
  const model = ref.slice(separator + 1);
  if (model === '' || !(AI_PROVIDERS as readonly string[]).includes(provider)) return undefined;

  return { provider: provider as AiProvider, model };
}

/** Both halves of the keyset are present, so a Test is worth attempting. */
export function isEbayConfigured(ebay: EbaySourceSettings): boolean {
  return ebay.clientId !== '' && ebay.clientSecret !== '';
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
