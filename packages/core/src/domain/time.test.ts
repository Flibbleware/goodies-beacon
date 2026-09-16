import { describe, expect, it } from 'vitest';
import { startOfDayIn } from './time.js';

const at = (iso: string) => new Date(iso);

describe('startOfDayIn', () => {
  it('is the UTC midnight of the same day in UTC', () => {
    expect(startOfDayIn('UTC', at('2026-09-16T14:20:00Z')).toISOString()).toBe(
      '2026-09-16T00:00:00.000Z',
    );
  });

  /**
   * The case the dashboard gets wrong if this is skipped: British Summer Time is UTC+1, so local
   * midnight is 23:00 the previous day in UTC, and a match found at 00:30 BST belongs to today.
   */
  it('is the previous UTC evening during British Summer Time', () => {
    expect(startOfDayIn('Europe/London', at('2026-06-16T00:30:00Z')).toISOString()).toBe(
      '2026-06-15T23:00:00.000Z',
    );
  });

  it('is UTC midnight in London in winter', () => {
    expect(startOfDayIn('Europe/London', at('2026-01-16T09:00:00Z')).toISOString()).toBe(
      '2026-01-16T00:00:00.000Z',
    );
  });

  /**
   * The reason the offset is resolved twice. At 09:00 on the morning the clocks go forward the
   * zone is UTC+1, but midnight that day happened while it was still UTC+0 — a single pass would
   * put the start of the day an hour early, in the previous day.
   */
  it('uses the offset in force at midnight, not the one in force now', () => {
    // 29 March 2026: BST begins at 01:00 UTC.
    expect(startOfDayIn('Europe/London', at('2026-03-29T09:00:00Z')).toISOString()).toBe(
      '2026-03-29T00:00:00.000Z',
    );
  });

  it('handles the morning the clocks go back the same way', () => {
    // 25 October 2026: BST ends at 02:00 local, 01:00 UTC.
    expect(startOfDayIn('Europe/London', at('2026-10-25T09:00:00Z')).toISOString()).toBe(
      '2026-10-24T23:00:00.000Z',
    );
  });

  it('works for a zone ahead of UTC and one behind it', () => {
    // 14:20 UTC is late on the 16th in Tokyo (UTC+9), so that day began at 15:00 UTC on the 15th.
    expect(startOfDayIn('Asia/Tokyo', at('2026-09-16T14:20:00Z')).toISOString()).toBe(
      '2026-09-15T15:00:00.000Z',
    );
    // And mid-morning on the 16th in New York (UTC-4 in September).
    expect(startOfDayIn('America/New_York', at('2026-09-16T14:20:00Z')).toISOString()).toBe(
      '2026-09-16T04:00:00.000Z',
    );
  });

  it('refuses a zone that is not one, rather than guessing UTC', () => {
    expect(() => startOfDayIn('Middle/Earth', at('2026-09-16T14:20:00Z'))).toThrow();
  });
});
