import { describe, expect, it } from 'vitest';
import { durationToHours, hoursToDuration, scheduledHours } from './duration.js';

describe('poll intervals in hours (P1-26)', () => {
  it('reads a stored interval back as the hours the form shows', () => {
    expect(durationToHours('PT8H')).toBe(8);
    expect(durationToHours('P1D')).toBe(24);
    expect(durationToHours(hoursToDuration(6))).toBe(6);
  });

  it('declines what is not a whole number of hours rather than rounding it', () => {
    expect(durationToHours('PT90M')).toBeUndefined();
    expect(durationToHours('P1M')).toBeUndefined();
    expect(durationToHours('not a duration')).toBeUndefined();
  });

  it('says what the scheduler will run, rounded up to what cron can express', () => {
    expect(scheduledHours(8)).toBe(8);
    expect(scheduledHours(5)).toBe(6);
    expect(scheduledHours(7)).toBe(8);
    expect(scheduledHours(13)).toBe(24);
    expect(scheduledHours(48)).toBe(24);
  });
});
