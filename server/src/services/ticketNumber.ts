import type { PrismaClient } from '../generated/prisma/client.ts';

// Ticket Number generation (specification.md BR-01, BR-28, §7.4, §7.6).
//
// A Ticket Number is `TKT-<YYYY>-<NNNNNN>`: the 4-digit year the ticket was
// created, in Asia/Bangkok time, and a zero-padded, gap-free, per-year
// sequence starting at 1. Slice 8b provides the formatter and the atomic
// allocator; slice 8c wires the allocator into the ticket-creation
// transaction and adds the unique-violation retry (BR-28).

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

/**
 * Minimal shape `allocateSequenceForYear`/`allocateTicketNumber` need from
 * a Prisma client. Both the top-level `prisma` singleton and the `tx`
 * handed to a `prisma.$transaction(async (tx) => ...)` callback satisfy
 * this, so the allocator works standalone (as in this slice's tests) and
 * inside the caller's own transaction (as 8c's ticket-creation flow
 * requires per BR-28).
 */
export type TicketCounterClient = Pick<PrismaClient, '$queryRaw'>;

/**
 * Atomically increments (creating on first use) the per-year counter row
 * and returns the new value — the ticket's sequence number within `year`.
 *
 * §7.6 is explicit that `TicketCounter` is never seeded; rows are created
 * lazily on the first ticket of each year. A `findUnique` followed by a
 * conditional `create`/`update` (read-then-write) would race: two
 * concurrent callers can both read "no row" (or the same `lastValue`) and
 * both write the same sequence number, which is exactly the duplicate BR-28
 * forbids. `INSERT ... ON CONFLICT (year) DO UPDATE ... RETURNING` is a
 * single statement — Postgres takes the row lock as part of the upsert, so
 * concurrent callers serialize on it and each gets a distinct, sequential
 * `lastValue` with no gap and no duplicate.
 */
export async function allocateSequenceForYear(
  client: TicketCounterClient,
  year: number
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "TicketCounter" ("year", "lastValue")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "lastValue" = "TicketCounter"."lastValue" + 1
    RETURNING "lastValue";
  `;

  return rows[0].lastValue;
}

/**
 * Allocates and formats the next Ticket Number for `instant` (defaulting to
 * now). This is the function 8c calls from inside the ticket-creation
 * transaction, passing its `tx` as `client` so the counter increment is
 * part of the same transaction as the ticket insert.
 */
export async function allocateTicketNumber(
  client: TicketCounterClient,
  instant: Date = new Date()
): Promise<string> {
  const year = bangkokYear(instant);
  const sequence = await allocateSequenceForYear(client, year);
  return formatTicketNumber(year, sequence);
}
