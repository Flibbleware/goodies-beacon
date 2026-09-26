/**
 * Poll intervals as §4 stores them — ISO 8601 durations — read as the minutes and hours the
 * scheduler and the settings form work in. Pure, so the browser shares it with the scheduler
 * (`poll/interval.ts`, which also needs `node:crypto` and so cannot be imported there) and the
 * form can say what the schedule will actually be rather than a second copy of the rule.
 */

const DURATION =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export const MINUTES_PER_DAY = 24 * 60;

/** Periods a cron step divides the day into evenly. Anything else is snapped to one of these. */
const EXPRESSIBLE_MINUTES = [
  5,
  10,
  15,
  20,
  30,
  60,
  120,
  180,
  240,
  360,
  480,
  720,
  MINUTES_PER_DAY,
] as const;

export class IntervalError extends Error {
  override readonly name = 'IntervalError';
}

/**
 * ISO 8601 duration to whole minutes. Months and years are refused rather than approximated:
 * "poll every month" has no fixed length, and a scheduler that guessed 30 days would be wrong
 * for seven of the twelve.
 */
export function durationToMinutes(duration: string): number {
  const match = DURATION.exec(duration);
  if (!match || duration === 'P') {
    throw new IntervalError(`not an ISO 8601 duration: ${duration}`);
  }

  const [, years, months, weeks, days, hours, minutes, seconds] = match;
  if (years || months) {
    throw new IntervalError(
      `${duration} has no fixed length — use days, hours or minutes (P7D, PT8H, PT30M)`,
    );
  }

  const total =
    Number(weeks ?? 0) * 7 * MINUTES_PER_DAY +
    Number(days ?? 0) * MINUTES_PER_DAY +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Math.ceil(Number(seconds ?? 0) / 60);

  if (total <= 0) throw new IntervalError(`${duration} is not a positive interval`);
  return total;
}

/** The expressible period closest to `minutes`, never faster than the one asked for. */
export function snapToExpressible(minutes: number): number {
  for (const candidate of EXPRESSIBLE_MINUTES) {
    if (candidate >= minutes) return candidate;
  }
  return MINUTES_PER_DAY;
}

/** Whole hours as the duration the spec stores (P1-26's settings form takes hours, not ISO). */
export function hoursToDuration(hours: number): string {
  return `PT${hours}H`;
}

/**
 * A stored interval as hours for the form, or undefined when it is not a whole number of them —
 * a hand-written PT90M or P1M — which the form then shows as it is rather than rounding it away.
 */
export function durationToHours(duration: string): number | undefined {
  try {
    const minutes = durationToMinutes(duration);
    return minutes % 60 === 0 ? minutes / 60 : undefined;
  } catch {
    return undefined;
  }
}

/** The hours the scheduler will actually poll at for a request, rounded up as `snapToExpressible`. */
export function scheduledHours(hours: number): number {
  return snapToExpressible(hours * 60) / 60;
}
