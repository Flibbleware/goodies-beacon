/**
 * Reading a wall clock in the instance's own time zone (§14, and §10's digest after it).
 *
 * "Today's matches" has to mean today where the owner is, not today in UTC. In Europe/London that
 * is an hour's difference for seven months of the year, so a match found at half past midnight in
 * June would be filed under yesterday by anything that simply truncated the UTC timestamp — and
 * the dashboard would be quietly wrong every summer morning.
 *
 * `Intl` is the whole implementation: the zone database ships with Node, and the alternative is a
 * dependency that carries its own copy of it and goes stale.
 */

/** The zone's offset from UTC, in milliseconds, at a given instant. */
function offsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `hour` comes back as 24 at midnight under hour12: false, which Date.UTC rolls over correctly.
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );

  return asIfUtc - at.getTime();
}

/**
 * The instant at which the current day began in `timeZone`.
 *
 * Resolved twice on purpose. The first pass uses the offset in force *now* to find which local
 * day it is; the second re-reads the offset at that local midnight, because a clock change in
 * between means the two differ — on the morning the clocks go forward, midnight is an hour
 * further back than "now minus the current offset" suggests.
 *
 * An unknown zone name throws from `Intl`, which is right: the value is validated when settings
 * are saved, so a bad one here is a bug rather than a condition to paper over.
 */
export function startOfDayIn(timeZone: string, now: Date): Date {
  const local = new Date(now.getTime() + offsetMs(timeZone, now));
  const wallMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());

  const guess = new Date(wallMidnight - offsetMs(timeZone, now));
  return new Date(wallMidnight - offsetMs(timeZone, guess));
}
