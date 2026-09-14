import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  type AiKeys,
  type AiProvider,
  type AiRole,
  type Database,
  parseModelRef,
  readSettings,
  resolveAiProvider,
  type Settings,
} from '@goodies-beacon/core';
import type { LanguageModel } from 'ai';

/**
 * One model object per configured role (§9).
 *
 * Every provider is reached through the Vercel AI SDK, so switching one for another is a Settings
 * change and nothing above this file knows which is in use — which is the property P1-17's eval
 * suite leans on, and the reason `generateObject` is the only call the rest of the code makes.
 */

/** OpenRouter and Ollama both speak the OpenAI wire format, so one compatible client serves both. */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

export class ProviderNotConfiguredError extends Error {
  override readonly name = 'ProviderNotConfiguredError';
  constructor(readonly provider: AiProvider) {
    super(
      provider === 'ollama'
        ? 'Ollama has no base URL. Set one in Settings, or OLLAMA_BASE_URL in .env.'
        : `No API key for ${provider}. Add one in Settings, or in .env.`,
    );
  }
}

export class UnknownModelRefError extends Error {
  override readonly name = 'UnknownModelRefError';
}

export interface ResolvedRole {
  provider: AiProvider;
  model: string;
  languageModel: LanguageModel;
}

export interface ProviderDeps {
  settings: Settings;
  secretKey: string;
  /** Keys from `.env`, used when Settings has none for that provider (§12). */
  env?: AiKeys;
}

/**
 * Builds the model for one `provider:model` reference.
 *
 * Each call constructs its own client rather than caching one per provider: a key can change in
 * Settings between two jobs, and a cached client would keep using the old one until a restart —
 * which is exactly the "it worked after I redeployed" class of bug.
 */
export function createModel(ref: string, deps: ProviderDeps): ResolvedRole {
  const parsed = parseModelRef(ref);
  if (!parsed) {
    throw new UnknownModelRefError(
      `"${ref}" is not a provider:model reference — expected something like openai:gpt-5-mini`,
    );
  }

  const { provider, model } = parsed;
  const credential = resolveAiProvider(deps.settings, provider, deps.secretKey, deps.env);
  // Ollama may run without a URL configured, in which case the local default is the right guess.
  if (!credential && provider !== 'ollama') throw new ProviderNotConfiguredError(provider);

  return { provider, model, languageModel: languageModel(provider, model, credential) };
}

function languageModel(
  provider: AiProvider,
  model: string,
  credential: string | undefined,
): LanguageModel {
  const apiKey = credential ?? '';

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'openrouter':
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
      })(model);
    case 'ollama':
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: normaliseOllamaUrl(credential),
        // A local server wants no key, but the OpenAI client insists on sending the header.
        apiKey: 'ollama',
      })(model);
  }
}

/**
 * Ollama's OpenAI-compatible endpoint lives under `/v1`, which an operator who copied the base
 * URL out of the Ollama docs will not have included. Appending it here is the difference between
 * working and a 404 that says nothing useful.
 */
export function normaliseOllamaUrl(baseUrl: string | undefined): string {
  const url = (baseUrl ?? '').trim().replace(/\/+$/, '');
  if (url === '') return OLLAMA_DEFAULT_BASE_URL;
  return url.endsWith('/v1') ? url : `${url}/v1`;
}

/** The model configured for a role, read fresh so a Settings change takes effect immediately. */
export async function modelForRole(
  db: Database,
  role: AiRole,
  secretKey: string,
  env?: AiKeys,
): Promise<ResolvedRole> {
  const settings = await readSettings(db);
  return createModel(settings.ai.roles[role], { settings, secretKey, ...(env ? { env } : {}) });
}
