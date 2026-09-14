import { describe, expect, it } from 'vitest';
import {
  durationToMinutes,
  IntervalError,
  pollSchedule,
  snapToExpressible,
  staggerOffset,
} from './interval.js';

describe('durationToMinutes', () => {
  it('reads the durations a spec actually carries', () => {
    expect(durationToMinutes('PT8H')).toBe(480);
    expect(durationToMinutes('PT1H')).toBe(60);
    expect(durationToMinutes('PT30M')).toBe(30);
    expect(durationToMinutes('P1D')).toBe(1440);
    expect(durationToMinutes('P1W')).toBe(10_080);
    expect(durationToMinutes('P1DT12H')).toBe(2160);
  });

  /** A part-minute interval would otherwise round to zero and schedule every minute. */
  it('rounds seconds up to a whole minute', () => {
    expect(durationToMinutes('PT90S')).toBe(2);
    expect(durationToMinutes('PT1S')).toBe(1);
  });

  it('refuses months and years rather than guessing their length', () => {
    expect(() => durationToMinutes('P1M')).toThrow(IntervalError);
    expect(() => durationToMinutes('P1Y')).toThrow('no fixed length');
  });

  it('refuses anything that is not a duration, including an empty one', () => {
    for (const bad of ['', 'P', '8h', 'PT', 'every 8 hours', 'PT0H']) {
      expect(() => durationToMinutes(bad)).toThrow(IntervalError);
    }
  });
});

describe('snapToExpressible', () => {
  /**
   * The point of snapping: cron steps run within a field, so `*\/7` on the hour fires at 0, 7, 14,
   * 21 and then 0 again — a three-hour gap in what was asked to be a seven-hour cycle.
   */
  it('never returns a period faster than the one asked for', () => {
    for (let minutes = 1; minutes <= 1440; minutes += 1) {
      expect(snapToExpressible(minutes)).toBeGreaterThanOrEqual(minutes);
    }
  });

  it('snaps an inexpressible interval up to the next period that divides the day', () => {
    expect(snapToExpressible(420)).toBe(480);
    expect(snapToExpressible(7)).toBe(10);
    expect(snapToExpressible(480)).toBe(480);
  });

  it('caps at daily, because a longer cycle cannot be a cron expression at all', () => {
    expect(snapToExpressible(10_080)).toBe(1440);
  });
});

describe('staggerOffset', () => {
  it('is stable for a plan, so a restart does not reshuffle every schedule', () => {
    expect(staggerOffset('plan-a', 480)).toBe(staggerOffset('plan-a', 480));
  });

  it('spreads plans across the period rather than landing them together', () => {
    const offsets = new Set(Array.from({ length: 50 }, (_, n) => staggerOffset(`plan-${n}`, 480)));
    expect(offsets.size).toBeGreaterThan(40);
  });

  it('stays inside the period', () => {
    for (let n = 0; n < 200; n += 1) {
      expect(staggerOffset(`plan-${n}`, 60)).toBeLessThan(60);
    }
  });
});

describe('pollSchedule', () => {
  it('writes an hourly interval as a step within the hours field', () => {
    const schedule = pollSchedule('plan-a', 480);
    expect(schedule.periodMinutes).toBe(480);
    expect(schedule.cron).toMatch(/^\d{1,2} \d{1,2}\/8 \* \* \*$/);
    expect(schedule.adjustedFrom).toBeUndefined();
  });

  it('writes a daily interval as a single hour', () => {
    expect(pollSchedule('plan-a', 1440).cron).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  /**
   * A sub-hourly step is a minute list rather than `50/20`, which fires at 50 and then not again
   * until 10 past — a 20-minute step with a 40-minute gap in it.
   */
  it('writes a sub-hourly interval as an explicit minute list with no gap at the hour', () => {
    const { cron } = pollSchedule('plan-a', 20);
    const minutes = (cron.split(' ')[0] ?? '').split(',').map(Number);
    expect(minutes).toHaveLength(3);
    for (let n = 1; n < minutes.length; n += 1) {
      expect((minutes[n] ?? 0) - (minutes[n - 1] ?? 0)).toBe(20);
    }
    expect(minutes[0]).toBeLessThan(20);
  });

  it('refuses to poll faster than the source says is polite, and says it adjusted', () => {
    const schedule = pollSchedule('plan-a', 5, 60);
    expect(schedule.periodMinutes).toBe(60);
    expect(schedule.adjustedFrom).toBe(5);
  });

  it('leaves an interval slower than the minimum alone', () => {
    expect(pollSchedule('plan-a', 480, 60).periodMinutes).toBe(480);
  });

  it('reports the snap when cron cannot express what was asked for', () => {
    const schedule = pollSchedule('plan-a', 420);
    expect(schedule.periodMinutes).toBe(480);
    expect(schedule.adjustedFrom).toBe(420);
  });

  it('gives two plans on the same interval different times', () => {
    expect(pollSchedule('plan-a', 480).cron).not.toBe(pollSchedule('plan-b', 480).cron);
  });
});
