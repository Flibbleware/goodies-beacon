import { describe, expect, it } from 'vitest';
import { clientKey, createLoginRateLimiter, MAX_ATTEMPTS, WINDOW_MS } from './rate-limit.js';

const START = new Date('2026-09-12T10:00:00Z');
const at = (ms: number) => new Date(START.getTime() + ms);

function failTimes(limiter: ReturnType<typeof createLoginRateLimiter>, count: number, now = START) {
  for (let i = 0; i < count; i += 1) limiter.recordFailure('1.2.3.4', now);
}

describe('createLoginRateLimiter', () => {
  it('allows the first attempts and locks out once the limit is reached', () => {
    const limiter = createLoginRateLimiter();

    failTimes(limiter, MAX_ATTEMPTS - 1);
    expect(limiter.check('1.2.3.4', START).allowed).toBe(true);

    limiter.recordFailure('1.2.3.4', START);
    expect(limiter.check('1.2.3.4', START).allowed).toBe(false);
  });

  it('reports how long the lockout has left', () => {
    const limiter = createLoginRateLimiter();
    failTimes(limiter, MAX_ATTEMPTS);

    expect(limiter.check('1.2.3.4', at(0)).retryAfterSeconds).toBe(WINDOW_MS / 1000);
    expect(limiter.check('1.2.3.4', at(WINDOW_MS / 2)).retryAfterSeconds).toBe(WINDOW_MS / 2000);
  });

  it('lets the client back in once the lockout expires', () => {
    const limiter = createLoginRateLimiter();
    failTimes(limiter, MAX_ATTEMPTS);

    expect(limiter.check('1.2.3.4', at(WINDOW_MS - 1)).allowed).toBe(false);
    expect(limiter.check('1.2.3.4', at(WINDOW_MS)).allowed).toBe(true);
  });

  it('forgets failures that are older than the window rather than accumulating them', () => {
    const limiter = createLoginRateLimiter();

    failTimes(limiter, MAX_ATTEMPTS - 1, START);
    failTimes(limiter, MAX_ATTEMPTS - 1, at(WINDOW_MS + 1));

    expect(limiter.check('1.2.3.4', at(WINDOW_MS + 1)).allowed).toBe(true);
  });

  it('counts each client separately', () => {
    const limiter = createLoginRateLimiter();
    failTimes(limiter, MAX_ATTEMPTS);

    expect(limiter.check('1.2.3.4', START).allowed).toBe(false);
    expect(limiter.check('5.6.7.8', START).allowed).toBe(true);
  });

  it('clears the record on a success, so ordinary use never approaches the limit', () => {
    const limiter = createLoginRateLimiter();

    failTimes(limiter, MAX_ATTEMPTS - 1);
    limiter.clear('1.2.3.4');
    failTimes(limiter, MAX_ATTEMPTS - 1);

    expect(limiter.check('1.2.3.4', START).allowed).toBe(true);
  });
});

describe('clientKey', () => {
  it('takes the last X-Forwarded-For entry, the only one the proxy wrote', () => {
    expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('spoofed, 10.0.0.1 , 203.0.113.9')).toBe('203.0.113.9');
  });

  it('puts direct connections in one bucket rather than none', () => {
    expect(clientKey(undefined)).toBe('unknown');
    expect(clientKey('')).toBe('unknown');
    expect(clientKey('  ,  ')).toBe('unknown');
  });
});
