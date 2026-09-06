// Ticket Number generation (specification.md BR-01, BR-28, §7.4, §7.6).
//
// A Ticket Number is `TKT-<YYYY>-<NNNNNN>`: the 4-digit year the ticket was
// created, in Asia/Bangkok time, and a zero-padded, gap-free, per-year
// sequence starting at 1. This is the formatter half of BR-01. The atomic
// per-year allocator lands separately.

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

// `Intl.DateTimeFormat` instances are safe to reuse across calls (and across
// concurrent calls) — `format()` takes the instant explicitly, so this never
// touches the host's local time zone or `Date.prototype.getFullYear()`.
const bangkokYearFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BANGKOK_TIME_ZONE,
  year: 'numeric',
});

/**
 * The 4-digit calendar year of `instant` as observed in Asia/Bangkok
 * (UTC+7, no DST), independent of the host machine's own time zone.
 *
 * BR-01 requires the Ticket Number's year component to be the Bangkok
 * calendar year of creation, not UTC and not wherever the server happens to
 * run. `getUTCFullYear()` or `getFullYear()` would both be wrong: the former
 * is off whenever the UTC instant and its Bangkok equivalent straddle a
 * year boundary (e.g. any time from 17:00:00 UTC on Dec 31 onward), and the
 * latter is wrong on any host that isn't itself UTC+7.
 */
export function bangkokYear(instant: Date): number {
  return Number(bangkokYearFormatter.format(instant));
}

/**
 * Formats a Ticket Number from its year and per-year sequence (BR-01).
 *
 * The sequence is zero-padded to 6 digits (`000001`, ..., `999999`). Beyond
 * 999999 the field simply grows (`1000000`, ...) rather than truncating or
 * wrapping — `String.prototype.padStart` never removes digits, so a 7th
 * ticket-year digit is possible in principle but does not corrupt or
 * collide with any earlier number, and a strictly-numeric-per-year sequence
 * keeps `ticketNumber` sortable as a string within a year. Reaching 1e6
 * tickets in a single calendar year is not a realistic Lab 2 scenario; this
 * is a documented, deliberate choice rather than an unhandled edge case.
 */
export function formatTicketNumber(year: number, sequence: number): string {
  const yearPart = String(year).padStart(4, '0');
  const sequencePart = String(sequence).padStart(6, '0');
  return `TKT-${yearPart}-${sequencePart}`;
}
