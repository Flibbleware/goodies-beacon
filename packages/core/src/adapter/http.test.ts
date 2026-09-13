import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from './http.js';

/**
 * Vitest's fake timers rather than a hand-rolled clock: the first attempt at this file faked
 * `sleep` by adding to a shared counter, which makes two concurrent waits sum instead of
 * overlapping — so a correct client looked broken. Faking `setTimeout` and `Date.now` together
 * models concurrency properly and exercises the real sleeping path rather than a substitute.
 */
beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The interval between consecutive starts, which is what the pacing is actually about. */
function gaps(starts: readonly number[]): number[] {
  return starts.slice(1).map((start, index) => start - (starts[index] ?? 0));
}

/** Records the fake time each request started at, and the highest number ever in flight. */
function recordingFetch(resolveAfterMs = 0) {
  const starts: number[] = [];
  let inFlight = 0;
  let peak = 0;
  const impl = (async () => {
    starts.push(Date.now());
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    if (resolveAfterMs > 0) await new Promise((r) => setTimeout(r, resolveAfterMs));
    inFlight -= 1;
    return new Response('ok');
  }) as unknown as typeof fetch;
  return { impl, starts, peak: () => peak };
}

/**
 * Runs `work` to completion, stepping the fake clock to each pending timer in turn rather than
 * advancing by a fixed amount — a blunt "advance 50 seconds" leaves the clock wherever it landed,
 * which the next assertion then has to know about.
 */
async function settle<T>(work: Promise<T>): Promise<T> {
  let finished = false;
  const tracked = work.then(
    (value) => {
      finished = true;
      return { ok: true as const, value };
    },
    (error: unknown) => {
      finished = true;
      return { ok: false as const, error };
    },
  );

  for (let step = 0; step < 1000 && !finished; step += 1) {
    if (vi.getTimerCount() === 0) {
      await Promise.resolve();
      continue;
    }
    await vi.advanceTimersToNextTimerAsync();
  }

  const result = await tracked;
  if (!result.ok) throw result.error;
  return result.value;
}

describe('the rate-limited HTTP client', () => {
  it('spaces requests by the configured delay', async () => {
    const { impl, starts } = recordingFetch();
    const client = createHttpClient({
      minDelayMs: 1000,
      maxDelayMs: 1000,
      random: () => 0,
      fetchImpl: impl,
    });

    await settle(
      (async () => {
        await client.fetch('https://example.com/1');
        await client.fetch('https://example.com/2');
        await client.fetch('https://example.com/3');
      })(),
    );

    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('jitters within the configured band rather than firing on a metronome', async () => {
    const { impl, starts } = recordingFetch();
    const randoms = [0, 0.5, 1];
    let index = 0;
    const client = createHttpClient({
      minDelayMs: 800,
      maxDelayMs: 2500,
      random: () => randoms[index++] ?? 0,
      fetchImpl: impl,
    });

    await settle(
      (async () => {
        await client.fetch('https://example.com/1');
        await client.fetch('https://example.com/2');
        await client.fetch('https://example.com/3');
      })(),
    );

    // Gaps of 800, then 1650 — the band's floor and its middle, not a fixed interval.
    expect(gaps(starts)).toEqual([800, 1650]);
  });

  it('does not wait when enough time has already passed', async () => {
    const { impl, starts } = recordingFetch();
    const client = createHttpClient({
      minDelayMs: 1000,
      maxDelayMs: 1000,
      random: () => 0,
      fetchImpl: impl,
    });

    await settle(client.fetch('https://example.com/1'));
    await vi.advanceTimersByTimeAsync(5000);
    await settle(client.fetch('https://example.com/2'));

    // The second request was already due, so it went straight out at the current time.
    expect(starts).toEqual([0, 5000]);
  });

  it('never runs more requests at once than the configured concurrency', async () => {
    const { impl, peak } = recordingFetch(50);
    const client = createHttpClient({
      concurrency: 2,
      minDelayMs: 0,
      maxDelayMs: 0,
      random: () => 0,
      fetchImpl: impl,
    });

    await settle(
      Promise.all(Array.from({ length: 6 }, (_, i) => client.fetch(`https://example.com/${i}`))),
    );

    expect(peak()).toBeLessThanOrEqual(2);
  });

  it('keeps spacing requests even when several may be in flight', async () => {
    const { impl, starts } = recordingFetch();
    const client = createHttpClient({
      concurrency: 3,
      minDelayMs: 500,
      maxDelayMs: 500,
      random: () => 0,
      fetchImpl: impl,
    });

    await settle(
      Promise.all(Array.from({ length: 3 }, (_, i) => client.fetch(`https://example.com/${i}`))),
    );

    expect([...starts].sort((a, b) => a - b)).toEqual([0, 500, 1000]);
  });

  it('sends the configured user agent without overriding one a caller set', async () => {
    const seen: Headers[] = [];
    const impl = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response('ok');
    }) as unknown as typeof fetch;
    const client = createHttpClient({
      minDelayMs: 0,
      maxDelayMs: 0,
      userAgent: 'goodies-beacon/0.2',
      random: () => 0,
      fetchImpl: impl,
    });

    await settle(
      (async () => {
        await client.fetch('https://example.com/1');
        await client.fetch('https://example.com/2', {
          headers: { 'user-agent': 'something-else' },
        });
      })(),
    );

    expect(seen[0]?.get('user-agent')).toBe('goodies-beacon/0.2');
    expect(seen[1]?.get('user-agent')).toBe('something-else');
  });

  it('releases its slot when a request throws, so one failure does not wedge the client', async () => {
    let call = 0;
    const impl = (async () => {
      call += 1;
      if (call === 1) throw new Error('connection reset');
      return new Response('ok');
    }) as unknown as typeof fetch;
    const client = createHttpClient({
      concurrency: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
      random: () => 0,
      fetchImpl: impl,
    });

    await expect(settle(client.fetch('https://example.com/1'))).rejects.toThrow('connection reset');
    await expect(settle(client.fetch('https://example.com/2'))).resolves.toBeInstanceOf(Response);
  });

  it('reports the exit address, which is what the proxy Test button shows', async () => {
    const impl = (async () =>
      new Response(
        JSON.stringify({ ip: '203.0.113.7', country: 'GB' }),
      )) as unknown as typeof fetch;
    const client = createHttpClient({ minDelayMs: 0, maxDelayMs: 0, fetchImpl: impl });

    await expect(settle(client.exitAddress())).resolves.toEqual({
      ip: '203.0.113.7',
      country: 'GB',
    });
  });

  it('fails loudly when the exit address cannot be read', async () => {
    const impl = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const client = createHttpClient({ minDelayMs: 0, maxDelayMs: 0, fetchImpl: impl });

    await expect(settle(client.exitAddress())).rejects.toThrow(/HTTP 503/);
  });
});
