import { z } from 'zod';
import { isSourceId, SOURCE_IDS, type SourceId } from './sources.js';

export const ROLES = ['api', 'worker', 'all'] as const;
export type Role = (typeof ROLES)[number];

/** pino's levels, so LOG_LEVEL can be handed to the logger unchanged (§P0-08). */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 32 bytes of base64 is 43 payload characters and a single '=' of padding. */
const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

const SECRET_KEY_HELP =
  'must be 32 random bytes, base64-encoded — generate with: openssl rand -base64 32';

const optionalSecret = z.string().min(1).optional();

const schema = z.object({
  GOODIES_BEACON_HOST: z.string().min(1),
  GOODIES_BEACON_SECRET_KEY: z.string().regex(BASE64_32_BYTES, SECRET_KEY_HELP),
  DATABASE_URL: z.string().refine(isPostgresUrl, 'must be a postgres:// connection URL'),
  ROLE: z.enum(ROLES).default('all'),
  WORKER_SOURCES: z
    .string()
    .default('')
    .transform(splitList)
    .superRefine((ids, ctx) => {
      const unknown = ids.filter((id) => !isSourceId(id));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown source(s): ${unknown.join(', ')}. Known sources: ${SOURCE_IDS.join(', ')}`,
        });
      }
    })
    .transform((ids) => ids as SourceId[]),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GOODIES_BEACON_VERSION: z.string().min(1).default('dev'),
  GOODIES_BEACON_SHA: z.string().min(1).default('unknown'),
  MEDIA_DIR: z.string().min(1).default('/data/media'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ANTHROPIC_API_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalSecret,
  OPENROUTER_API_KEY: optionalSecret,
  OLLAMA_BASE_URL: optionalSecret,
});

/** Every variable the schema reads. Used to prove .env.example has not drifted. */
export const CONFIG_VARIABLES: readonly string[] = Object.keys(schema.shape).sort();

export interface AiKeys {
  readonly anthropicApiKey: string | undefined;
  readonly openaiApiKey: string | undefined;
  readonly googleGenerativeAiApiKey: string | undefined;
  readonly openrouterApiKey: string | undefined;
  readonly ollamaBaseUrl: string | undefined;
}

export interface Config {
  readonly host: string;
  /** The image tag this build was published under, baked in at build time. `/healthz` reports it. */
  readonly version: string;
  /** The commit the image was built from, or 'unknown' outside a built image. */
  readonly sha: string;
  /** True in the image, which is the only place the API serves the built web app. */
  readonly isProduction: boolean;
  readonly databaseUrl: string;
  /** Base64; decode to 32 bytes where the encryption helpers need them (P0-05). */
  readonly secretKey: string;
  readonly role: Role;
  /** Sources this process polls. Empty means every source, per §6. */
  readonly workerSources: readonly SourceId[];
  readonly logLevel: LogLevel;
  readonly mediaDir: string;
  readonly port: number;
  readonly ai: AiKeys;
  /** Redacts secrets so a whole config can be logged without leaking them (§12). */
  toJSON(): Record<string, unknown>;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Validate an environment into a Config, or throw ConfigError listing every problem at once.
 * Pure: pass an object in tests rather than mutating process.env.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const provided = withoutBlanks(env);
  const result = schema.safeParse(provided);

  if (!result.success) {
    throw new ConfigError(formatIssues(result.error.issues, provided));
  }

  const v = result.data;
  const ai: AiKeys = {
    anthropicApiKey: v.ANTHROPIC_API_KEY,
    openaiApiKey: v.OPENAI_API_KEY,
    googleGenerativeAiApiKey: v.GOOGLE_GENERATIVE_AI_API_KEY,
    openrouterApiKey: v.OPENROUTER_API_KEY,
    ollamaBaseUrl: v.OLLAMA_BASE_URL,
  };

  return {
    host: v.GOODIES_BEACON_HOST,
    version: v.GOODIES_BEACON_VERSION,
    sha: v.GOODIES_BEACON_SHA,
    isProduction: v.NODE_ENV === 'production',
    databaseUrl: v.DATABASE_URL,
    secretKey: v.GOODIES_BEACON_SECRET_KEY,
    role: v.ROLE,
    workerSources: v.WORKER_SOURCES,
    logLevel: v.LOG_LEVEL,
    mediaDir: v.MEDIA_DIR,
    port: v.PORT,
    ai,
    toJSON() {
      return {
        host: this.host,
        version: this.version,
        sha: this.sha,
        isProduction: this.isProduction,
        databaseUrl: redactUrlPassword(this.databaseUrl),
        secretKey: '[redacted]',
        role: this.role,
        workerSources: this.workerSources,
        logLevel: this.logLevel,
        mediaDir: this.mediaDir,
        port: this.port,
        ai: Object.fromEntries(
          Object.entries(this.ai).map(([name, value]) => [name, value ? '[set]' : null]),
        ),
      };
    },
  };
}

/**
 * Entry-point wrapper: print what is wrong and exit non-zero rather than throwing a stack
 * trace at someone whose only mistake was a missing variable.
 */
export function loadConfigOrExit(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    return parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

/** `FOO=` in a .env file arrives as '', which should mean "not set", not "set to empty". */
function withoutBlanks(env: NodeJS.ProcessEnv): Record<string, string> {
  const provided: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') provided[name] = value;
  }
  return provided;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

function redactUrlPassword(value: string): string {
  try {
    const url = new URL(value);
    if (url.password !== '') url.password = '***';
    return url.toString();
  } catch {
    return '[unparseable]';
  }
}

function formatIssues(issues: readonly z.core.$ZodIssue[], provided: Record<string, string>) {
  const lines = issues.map((issue) => {
    const name = String(issue.path[0] ?? '(root)');
    const reason = name in provided ? issue.message : 'is required';
    return { name, reason };
  });
  const width = Math.max(...lines.map((line) => line.name.length));
  const body = lines.map(({ name, reason }) => `  ${name.padEnd(width)}  ${reason}`).join('\n');
  return `Invalid configuration:\n\n${body}\n\nEvery variable is documented in .env.example.`;
}
