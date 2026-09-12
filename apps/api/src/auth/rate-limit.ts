/**
 * Login rate limiting (§12): five failures per window per client, then a lockout of the same
 * length. Successes clear the record, so ordinary use never approaches the limit.
 *
 * Held in memory rather than the database. The published surface is one API container behind
 * Caddy (§12), so one process sees every attempt; run two and each gets its own allowance. A
 * restart clears the counters, which only the owner can cause and which is how they unlock
 * themselves after locking themselves out.
 */
export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the next attempt is allowed; for the `Retry-After` header. */
  readonly retryAfterSeconds: number;
}

export interface LoginRateLimiter {
  check(key: string, now?: Date): RateLimitDecision;
  recordFailure(key: string, now?: Date): void;
  clear(key: string): void;
}

interface Attempts {
  failures: number;
  /** When the current window — or the lockout that followed it — ends. */
  until: number;
}

export function createLoginRateLimiter(): LoginRateLimiter {
  const records = new Map<string, Attempts>();

  const current = (key: string, now: number): Attempts | undefined => {
    const record = records.get(key);
    if (!record) return undefined;
    if (record.until <= now) {
      records.delete(key);
      return undefined;
    }
    return record;
  };

  return {
    check(key, now = new Date()) {
      const at = now.getTime();
      const record = current(key, at);
      const locked = record !== undefined && record.failures >= MAX_ATTEMPTS;
      return {
        allowed: !locked,
        retryAfterSeconds: locked ? Math.ceil((record.until - at) / 1000) : 0,
      };
    },

    recordFailure(key, now = new Date()) {
      const at = now.getTime();
      const record = current(key, at);

      if (!record) {
        records.set(key, { failures: 1, until: at + WINDOW_MS });
        return;
      }

      record.failures += 1;
      // The failure that reaches the limit starts a fresh window, which is the lockout.
      if (record.failures === MAX_ATTEMPTS) record.until = at + WINDOW_MS;
    },

    clear(key) {
      records.delete(key);
    },
  };
}

/**
 * Who to count attempts against. Caddy appends the real client to any `X-Forwarded-For` it is
 * given, so the last entry is the one it wrote and the only one a client cannot forge. Direct
 * connections — development, or a misconfigured proxy — share a single bucket, which is strict
 * rather than lax.
 */
export function clientKey(forwardedFor: string | undefined): string {
  const entries = (forwardedFor ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return entries.at(-1) ?? 'unknown';
}
