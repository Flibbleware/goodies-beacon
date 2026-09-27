import { createHash } from 'node:crypto';
import { MINUTES_PER_DAY, snapToExpressible } from '../domain/duration.js';

export { durationToMinutes, IntervalError, snapToExpressible } from '../domain/duration.js';

/**
 * Turning an item's poll interval into a pg-boss cron expression (§6).
 *
 * pg-boss schedules are cron, so an interval has to become a recurrence. Cron cannot express
 * "every 7 hours" — a step runs within a field, so the day restarts the cycle — and a schedule
 * that quietly means something other than what was asked for is worse than one that is rounded
 * openly. So an interval is snapped to the nearest expressible period and the caller is told
 * which, rather than a `*\/7` being written that fires at 0, 7, 14 and 21 and then again at 0.
 */

/**
 * A stable offset in [0, period) for an item, so different items poll at different times.
 *
 * §6 asks for the stagger so a hundred eBay plans do not all fire in the same second; deriving it
 * from the item id rather than randomising means a restart does not reshuffle every schedule, and
 * `reconcile` can compare what it wants against what is installed without a spurious difference.
 */
export function staggerOffset(itemId: string, periodMinutes: number): number {
  const digest = createHash('sha256').update(itemId).digest();
  return digest.readUInt32BE(0) % periodMinutes;
}

/**
 * Minutes between one plan of an item and the next (P1-31). Enough that they never fire in the
 * same second; little enough that an item's plans run as one sweep rather than one by one across
 * the whole interval, which left an item's newest plans saying "never" for hours.
 */
export const PLAN_GAP_MINUTES = 2;

/** Where a plan falls: its item, and its place among that item's scheduled plans. */
export interface PlanSlot {
  itemId: string;
  position: number;
}

export interface PollSchedule {
  cron: string;
  /** The period actually installed, which may be longer than the one requested. */
  periodMinutes: number;
  /** Set when the interval was snapped or clamped, for the log line and the UI. */
  adjustedFrom?: number;
}

/**
 * The cron expression for one plan: its item's offset, then `PLAN_GAP_MINUTES` for each plan of
 * the item before it.
 *
 * `minimumMinutes` is the source's `recommendedMinInterval` (§5): the scheduler refuses to poll
 * faster than the adapter says is polite, whatever the item asks for.
 */
export function pollSchedule(
  slot: PlanSlot,
  intervalMinutes: number,
  minimumMinutes = 0,
): PollSchedule {
  const requested = Math.max(1, Math.round(intervalMinutes));
  const period = snapToExpressible(Math.max(requested, Math.round(minimumMinutes)));
  const offset = (staggerOffset(slot.itemId, period) + slot.position * PLAN_GAP_MINUTES) % period;

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
