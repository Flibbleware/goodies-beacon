import { encryptSecret, parseModelRef, type Settings, settingsSchema } from '@goodies-beacon/core';
import { describe, expect, it } from 'vitest';
import {
  createModel,
  normaliseOllamaUrl,
  ProviderNotConfiguredError,
  UnknownModelRefError,
} from './providers.js';

/** 32 bytes, base64, as the real key is. */
const SECRET_KEY = 'Z29vZGllcy1iZWFjb24tdGVzdC1rZXktMzJieXRlcyE=';

function settings(ai: Record<string, unknown> = {}): Settings {
  return settingsSchema.parse({ ai });
}

describe('parseModelRef', () => {
  it('reads provider and model', () => {
    expect(parseModelRef('openai:gpt-5-mini')).toEqual({ provider: 'openai', model: 'gpt-5-mini' });
  });

  /**
   * An Ollama model is itself `name:tag`, so splitting on every colon would drop the tag and
   * quietly run a different model from the one that was configured.
   */
  it('splits on the first colon only, so an Ollama name:tag survives', () => {
    expect(parseModelRef('ollama:llama3.1:8b')).toEqual({
      provider: 'ollama',
      model: 'llama3.1:8b',
    });
  });

  it('reads an OpenRouter model, which carries a slash rather than a colon', () => {
    expect(parseModelRef('openrouter:anthropic/claude-opus-5')).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-opus-5',
    });
  });

  it('refuses anything that is not provider:model', () => {
    for (const bad of ['', 'gpt-5-mini', 'openai:', ':gpt-5-mini', 'nosuch:model']) {
      expect(parseModelRef(bad), bad).toBeUndefined();
    }
  });
});

describe('createModel', () => {
  it('builds a model when the key is in Settings', () => {
    const role = createModel('openai:gpt-5-mini', {
      settings: settings({ openai: { apiKey: encrypted('sk-test') } }),
      secretKey: SECRET_KEY,
    });

    expect(role.provider).toBe('openai');
    expect(role.model).toBe('gpt-5-mini');
  });

  /** §12 allows either source; Settings is the specific place, `.env` the instance-wide one. */
  it('falls back to a key from the environment', () => {
    const role = createModel('anthropic:claude-opus-5', {
      settings: settings(),
      secretKey: SECRET_KEY,
      env: {
        anthropicApiKey: 'sk-ant-from-env',
        openaiApiKey: undefined,
        googleGenerativeAiApiKey: undefined,
        openrouterApiKey: undefined,
        ollamaBaseUrl: undefined,
      },
    });

    expect(role.provider).toBe('anthropic');
  });

  it('says which provider is missing a key rather than failing at the request', () => {
    expect(() =>
      createModel('google:gemini-2.5-flash', { settings: settings(), secretKey: SECRET_KEY }),
    ).toThrow(ProviderNotConfiguredError);
    expect(() =>
      createModel('google:gemini-2.5-flash', { settings: settings(), secretKey: SECRET_KEY }),
    ).toThrow(/google/);
  });

  /** A local server needs no key, so an unconfigured Ollama is a default rather than an error. */
  it('builds an Ollama model with no credential at all', () => {
    const role = createModel('ollama:llama3.1:8b', {
      settings: settings(),
      secretKey: SECRET_KEY,
    });

    expect(role.model).toBe('llama3.1:8b');
  });

  it('names the mistake when a role is not provider:model', () => {
    expect(() =>
      createModel('gpt-5-mini', { settings: settings(), secretKey: SECRET_KEY }),
    ).toThrow(UnknownModelRefError);
  });
});

describe('normaliseOllamaUrl', () => {
  /**
   * Ollama's OpenAI-compatible endpoint lives under `/v1`, which whoever copied the base URL out
   * of the Ollama docs will not have included — the difference between working and a bare 404.
   */
  it('appends the OpenAI-compatible path when it is missing', () => {
    expect(normaliseOllamaUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
    expect(normaliseOllamaUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1');
  });

  it('leaves a URL that already names it alone', () => {
    expect(normaliseOllamaUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
  });

  it('falls back to the local default when there is nothing configured', () => {
    expect(normaliseOllamaUrl(undefined)).toBe('http://localhost:11434/v1');
    expect(normaliseOllamaUrl('   ')).toBe('http://localhost:11434/v1');
  });
});

/** Settings hold secrets as `enc:v1:`, so a fixture key has to be wrapped the same way. */
function encrypted(value: string): string {
  return encryptSecret(value, SECRET_KEY);
}
