import { createHash } from 'node:crypto';

/**
 * Turning an item's poll interval into a pg-boss cron expression (§6).
 *
 * pg-boss schedules are cron, so an interval has to become a recurrence. Cron cannot express
 * "every 7 hours" — a step runs within a field, so the day restarts the cycle — and a schedule
 * that quietly means something other than what was asked for is worse than one that is rounded
 * openly. So an interval is snapped to the nearest expressible period and the caller is told
 * which, rather than a `*\/7` being written that fires at 0, 7, 14 and 21 and then again at 0.
 */

const DURATION =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

const MINUTES_PER_DAY = 24 * 60;

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

/**
 * A stable offset in [0, period) for a plan, so every plan's poll lands at a different minute.
 *
 * §6 asks for the stagger so a hundred eBay plans do not all fire in the same second; deriving it
 * from the plan id rather than randomising means a restart does not reshuffle every schedule, and
 * `reconcile` can compare what it wants against what is installed without a spurious difference.
 */
export function staggerOffset(planId: string, periodMinutes: number): number {
  const digest = createHash('sha256').update(planId).digest();
  return digest.readUInt32BE(0) % periodMinutes;
}

export interface PollSchedule {
  cron: string;
  /** The period actually installed, which may be longer than the one requested. */
  periodMinutes: number;
  /** Set when the interval was snapped or clamped, for the log line and the UI. */
  adjustedFrom?: number;
}

/**
 * The cron expression for one plan.
 *
 * `minimumMinutes` is the source's `recommendedMinInterval` (§5): the scheduler refuses to poll
 * faster than the adapter says is polite, whatever the item asks for.
 */
export function pollSchedule(
  planId: string,
  intervalMinutes: number,
  minimumMinutes = 0,
): PollSchedule {
  const requested = Math.max(1, Math.round(intervalMinutes));
  const period = snapToExpressible(Math.max(requested, Math.round(minimumMinutes)));
  const offset = staggerOffset(planId, period);

  const cron =
    period < 60
      ? `${withinHour(offset, period)} * * * *`
      : period === 60
        ? `${offset} * * * *`
        : period < MINUTES_PER_DAY
          ? `${offset % 60} ${Math.floor(offset / 60)}/${period / 60} * * *`
          : `${offset % 60} ${Math.floor(offset / 60)} * * *`;

  return period === requested
    ? { cron, periodMinutes: period }
    : { cron, periodMinutes: period, adjustedFrom: requested };
}

/**
 * Sub-hourly periods are written as an explicit minute list rather than `offset/step`, because a
 * cron step restarts at the top of each hour: `50/20` fires at 50 and then not again until 10
 * past, a 20-minute step with a 40-minute gap in it.
 */
function withinHour(offset: number, period: number): string {
  const minutes: number[] = [];
  for (let minute = offset % period; minute < 60; minute += period) minutes.push(minute);
  return minutes.join(',');
}
