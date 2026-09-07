import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_VARIABLES, ConfigError, loadConfigOrExit, parseConfig } from './config.js';

/** Shaped like `openssl rand -base64 32` output — 43 payload characters and one '='. */
const VALID_KEY = `${'A'.repeat(43)}=`;

const VALID_ENV = {
  GOODIES_BEACON_HOST: 'beacon.example.co.uk',
  GOODIES_BEACON_SECRET_KEY: VALID_KEY,
  DATABASE_URL: 'postgres://user:pw@db:5432/goodies_beacon',
} satisfies NodeJS.ProcessEnv;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseConfig', () => {
  it('applies documented defaults when only the required variables are set', () => {
    const config = parseConfig(VALID_ENV);

    expect(config.role).toBe('all');
    expect(config.logLevel).toBe('info');
    expect(config.mediaDir).toBe('/data/media');
    expect(config.port).toBe(3000);
    expect(config.workerSources).toEqual([]);
  });

  it('treats an empty variable as unset, so `FOO=` in .env does not defeat the default', () => {
    const config = parseConfig({
      ...VALID_ENV,
      ROLE: '',
      WORKER_SOURCES: '',
      MEDIA_DIR: '   ',
      ANTHROPIC_API_KEY: '',
    });

    expect(config.role).toBe('all');
    expect(config.mediaDir).toBe('/data/media');
    expect(config.ai.anthropicApiKey).toBeUndefined();
  });

  it('parses WORKER_SOURCES into known source ids, ignoring spacing', () => {
    const config = parseConfig({ ...VALID_ENV, WORKER_SOURCES: 'vinted , ebay' });
    expect(config.workerSources).toEqual(['vinted', 'ebay']);
  });

  it('coerces PORT from its string environment value', () => {
    expect(parseConfig({ ...VALID_ENV, PORT: '8080' }).port).toBe(8080);
  });

  it('names a missing variable and says it is required', () => {
    const { DATABASE_URL: _omitted, ...withoutDatabase } = VALID_ENV;

    expect(() => parseConfig(withoutDatabase)).toThrow(ConfigError);
    expect(() => parseConfig(withoutDatabase)).toThrow(/DATABASE_URL\s+is required/);
  });

  it('explains how to generate a malformed secret key', () => {
    const attempt = () => parseConfig({ ...VALID_ENV, GOODIES_BEACON_SECRET_KEY: 'change-me' });

    expect(attempt).toThrow(/GOODIES_BEACON_SECRET_KEY/);
    expect(attempt).toThrow(/openssl rand -base64 32/);
  });

  it('rejects a base64 key that is not exactly 32 bytes', () => {
    expect(() =>
      parseConfig({ ...VALID_ENV, GOODIES_BEACON_SECRET_KEY: `${'A'.repeat(20)}=` }),
    ).toThrow(ConfigError);
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    expect(() => parseConfig({ ...VALID_ENV, DATABASE_URL: 'mysql://db/goodies' })).toThrow(
      /DATABASE_URL\s+must be a postgres/,
    );
  });

  it('rejects an unknown ROLE and an unknown source, naming the offending value', () => {
    expect(() => parseConfig({ ...VALID_ENV, ROLE: 'admin' })).toThrow(/ROLE/);
    expect(() => parseConfig({ ...VALID_ENV, WORKER_SOURCES: 'ebay,gumtree' })).toThrow(/gumtree/);
  });

  it('reports every problem at once rather than one per run', () => {
    let message = '';
    try {
      parseConfig({ GOODIES_BEACON_SECRET_KEY: 'nope' });
    } catch (error) {
      message = (error as ConfigError).message;
    }

    expect(message).toMatch(/GOODIES_BEACON_HOST/);
    expect(message).toMatch(/GOODIES_BEACON_SECRET_KEY/);
    expect(message).toMatch(/DATABASE_URL/);
  });
});

describe('Config.toJSON', () => {
  it('redacts the secret key, the database password and AI keys', () => {
    const config = parseConfig({ ...VALID_ENV, ANTHROPIC_API_KEY: 'sk-ant-real-secret' });
    const logged = JSON.stringify(config);

    expect(logged).not.toContain(VALID_KEY);
    expect(logged).not.toContain('sk-ant-real-secret');
    expect(logged).not.toContain('pw@');
    expect(JSON.parse(logged)).toMatchObject({
      secretKey: '[redacted]',
      databaseUrl: 'postgres://user:***@db:5432/goodies_beacon',
      ai: { anthropicApiKey: '[set]', openaiApiKey: null },
    });
  });
});

describe('loadConfigOrExit', () => {
  it('prints the offending variable and exits non-zero', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('exited');
    }) as never);

    expect(() => loadConfigOrExit({})).toThrow('exited');
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/DATABASE_URL/);
  });

  it('returns the config and does not exit when the environment is valid', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    expect(loadConfigOrExit(VALID_ENV).host).toBe('beacon.example.co.uk');
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('.env.example', () => {
  const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  const lines = example.split('\n');
  const assignments = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^[A-Z][A-Z0-9_]*=/.test(line));

  it('documents every variable the config schema reads', () => {
    const documented = new Set(assignments.map(({ line }) => line.split('=')[0]));
    const missing = CONFIG_VARIABLES.filter((name) => !documented.has(name));

    expect(missing).toEqual([]);
  });

  it('gives every variable its own comment, not just a section heading', () => {
    const uncommented = assignments
      .filter(({ index }) => {
        const above = lines[index - 1] ?? '';
        return !above.startsWith('#') || above.includes('---');
      })
      .map(({ line }) => line.split('=')[0]);

    expect(uncommented).toEqual([]);
  });

  it('documents how to generate the secret key', () => {
    expect(example).toContain('openssl rand -base64 32');
  });
});
