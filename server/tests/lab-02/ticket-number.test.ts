import { describe, expect, it } from 'vitest';
import { bangkokYear, formatTicketNumber } from '../../src/services/ticketNumber.js';

// Covers docs/lab-02/specification.md BR-01 and tests.md UNIT-01.

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
