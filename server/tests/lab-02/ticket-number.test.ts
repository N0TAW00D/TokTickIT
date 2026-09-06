import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import {
  allocateSequenceForYear,
  allocateTicketNumber,
  bangkokYear,
  formatTicketNumber,
} from '../../src/services/ticketNumber.js';

// Covers docs/lab-02/specification.md BR-01, BR-28, §7.4, §7.6 and
// tests.md UNIT-01..UNIT-03. reset-db.ts (tests/setup/reset-db.ts) truncates
// TicketCounter before every test, so each test starts from a lazily-
// created counter, per §7.6 ("TicketCounter is not seeded").

describe('formatTicketNumber (UNIT-01)', () => {
  it('formats a single-digit sequence as TKT-<year>-000001', () => {
    expect(formatTicketNumber(2026, 1)).toBe('TKT-2026-000001');
  });

  it('does not truncate a sequence beyond 6 digits', () => {
    expect(formatTicketNumber(2026, 123456)).toBe('TKT-2026-123456');
  });

  it('grows rather than wraps or truncates past 999999', () => {
    // Documented behavior (see ticketNumber.ts): padStart never removes
    // digits, so the field grows to 7 digits instead of silently
    // truncating back to a 6-digit (and therefore colliding) value.
    expect(formatTicketNumber(2026, 1_000_000)).toBe('TKT-2026-1000000');
  });
});

describe('bangkokYear (BR-01: Asia/Bangkok, not UTC, not host-local)', () => {
  it('resolves the Bangkok calendar year, not the UTC calendar year, for an instant that straddles the boundary', () => {
    // 2025-12-31T18:00:00Z is 2026-01-01T01:00:00+07:00 in Bangkok (UTC+7,
    // no DST). A UTC-based implementation (`getUTCFullYear`) returns 2025
    // here; only a genuinely Asia/Bangkok-aware implementation returns
    // 2026. This also fails on any host whose local zone is not already
    // UTC+7 if the code used `Date.prototype.getFullYear()` instead.
    const instant = new Date('2025-12-31T18:00:00.000Z');

    expect(instant.getUTCFullYear()).toBe(2025); // sanity: UTC says 2025
    expect(bangkokYear(instant)).toBe(2026); // Bangkok already says 2026
  });

  it('resolves the Bangkok calendar year for an ordinary mid-year instant', () => {
    expect(bangkokYear(new Date('2026-06-15T12:00:00.000Z'))).toBe(2026);
  });
});

describe('allocateSequenceForYear / allocateTicketNumber (UNIT-02: gap-free per-year sequence)', () => {
  it('starts a new year at 1 and increments consecutively with no gaps', async () => {
    const first = await allocateSequenceForYear(prisma, 2026);
    const second = await allocateSequenceForYear(prisma, 2026);
    const third = await allocateSequenceForYear(prisma, 2026);

    expect([first, second, third]).toEqual([1, 2, 3]);
  });

  it('restarts a different year at 1 independently of another year in progress', async () => {
    expect(await allocateSequenceForYear(prisma, 2026)).toBe(1);
    expect(await allocateSequenceForYear(prisma, 2026)).toBe(2);

    // A different year's counter is a different row — it starts at 1
    // regardless of how far 2026's counter has advanced.
    expect(await allocateSequenceForYear(prisma, 2027)).toBe(1);

    // 2026's counter is unaffected by 2027 allocations.
    expect(await allocateSequenceForYear(prisma, 2026)).toBe(3);
  });

  it('end-to-end: allocateTicketNumber formats the allocated sequence using the Bangkok year of the given instant', async () => {
    const instant = new Date('2025-12-31T18:00:00.000Z'); // Bangkok: 2026-01-01

    const number = await allocateTicketNumber(prisma, instant);

    expect(number).toBe('TKT-2026-000001');
  });
});

describe('concurrent allocation (UNIT-03, BR-28)', () => {
  it('20 parallel allocations for the same year yield 20 distinct, sequential numbers — no duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => allocateTicketNumber(prisma, new Date('2026-05-01T00:00:00.000Z')))
    );

    const unique = new Set(results);
    expect(unique.size).toBe(20); // no duplicate ticket numbers

    const sequences = results
      .map((n) => Number(n.slice('TKT-2026-'.length)))
      .sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
