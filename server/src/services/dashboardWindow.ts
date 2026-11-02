// Pure dashboard time rules (specification.md BR-22; api-spec.md §4–§5). No
// database, no clock reads: every function takes `now` as an argument so tests
// can pin it. The BR-23 / D-10 resolution time is computed in the query
// (ticketFilters.ts, requesterDashboard.ts), not here.

export const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

// Asia/Bangkok is UTC+7 all year (no DST), so a fixed offset is exact.
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 Asia/Bangkok on the calendar day containing `now`, as a UTC instant. */
export function bangkokDayStart(now: Date): Date {
  const shifted = now.getTime() + BANGKOK_OFFSET_MS;
  const dayStartShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  return new Date(dayStartShifted - BANGKOK_OFFSET_MS);
}

/**
 * BR-22: 00:00 Bangkok on the day six days before today, so the window is
 * today plus the six previous Bangkok calendar days. "Updated recently" is
 * `updatedAt >= windowStart`.
 */
export function windowStart(now: Date): Date {
  return new Date(bangkokDayStart(now).getTime() - 6 * DAY_MS);
}
