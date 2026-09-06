import { describe, expect, it } from 'vitest';
import {
  validateDescription,
  validateRequestedPriority,
  validateSummary,
  validateTicketFields,
} from '../../src/validation/ticketFields.js';
import { parseTicketListQuery } from '../../src/validation/ticketListQuery.js';

// Covers docs/lab-02/specification.md §4-fields, A-03 and tests.md UNIT-04,
// plus (below) UNIT-05, the GET /api/tickets query-param parser (#18).
//
// Out of scope here: UNIT-06 (attachment type guard + safe filename, #17).

describe('validateSummary (UNIT-04)', () => {
  it('rejects a trimmed length of 4 (below the 5 minimum)', () => {
    const result = validateSummary('abcd');
    expect(result.ok).toBe(false);
  });

  it('accepts a trimmed length of exactly 5', () => {
    const result = validateSummary('abcde');
    expect(result).toEqual({ ok: true, value: 'abcde' });
  });

  it('rejects a trimmed length of 141 (above the 140 maximum)', () => {
    const result = validateSummary('a'.repeat(141));
    expect(result.ok).toBe(false);
  });

  it('accepts a trimmed length of exactly 140', () => {
    const value = 'a'.repeat(140);
    expect(validateSummary(value)).toEqual({ ok: true, value });
  });

  it('trims before judging length: "  hi  " trims to "hi" (length 2) and is rejected', () => {
    const result = validateSummary('  hi  ');
    expect(result.ok).toBe(false);
  });

  it('trims before persisting: leading/trailing whitespace is stripped, internal whitespace is preserved', () => {
    const result = validateSummary('  Printer is broken  ');
    expect(result).toEqual({ ok: true, value: 'Printer is broken' });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(validateSummary('').ok).toBe(false);
    expect(validateSummary('     ').ok).toBe(false);
  });

  it('rejects non-string input (e.g. missing field)', () => {
    expect(validateSummary(undefined).ok).toBe(false);
    expect(validateSummary(null).ok).toBe(false);
  });
});

describe('validateDescription (UNIT-04)', () => {
  it('rejects a trimmed length of 19 (below the 20 minimum)', () => {
    expect(validateDescription('a'.repeat(19)).ok).toBe(false);
  });

  it('accepts a trimmed length of exactly 20', () => {
    const value = 'a'.repeat(20);
    expect(validateDescription(value)).toEqual({ ok: true, value });
  });

  it('rejects a trimmed length of 5001 (above the 5000 maximum)', () => {
    expect(validateDescription('a'.repeat(5001)).ok).toBe(false);
  });

  it('accepts a trimmed length of exactly 5000', () => {
    const value = 'a'.repeat(5000);
    expect(validateDescription(value)).toEqual({ ok: true, value });
  });

  it('trims leading/trailing whitespace before the length check, preserving internal whitespace', () => {
    const inner = 'The printer on the 3rd floor is jammed again today.';
    const result = validateDescription(`  ${inner}  `);
    expect(result).toEqual({ ok: true, value: inner });
  });
});

describe('validateRequestedPriority', () => {
  it.each(['LOW', 'MEDIUM', 'HIGH'] as const)('accepts %s', (priority) => {
    expect(validateRequestedPriority(priority)).toEqual({ ok: true, value: priority });
  });

  it('rejects an unknown priority value', () => {
    expect(validateRequestedPriority('URGENT').ok).toBe(false);
  });

  it('rejects lowercase (case-sensitive match against the enum)', () => {
    expect(validateRequestedPriority('low').ok).toBe(false);
  });

  it('rejects missing/non-string input', () => {
    expect(validateRequestedPriority(undefined).ok).toBe(false);
  });
});

describe('validateTicketFields (aggregate, for the 400 VALIDATION_FAILED body shape)', () => {
  it('returns ok:true with all three trimmed/normalized values when every field is valid', () => {
    const result = validateTicketFields({
      summary: '  Printer is broken  ',
      description: '  '.concat('The printer on the 3rd floor is jammed.', '  '),
      requestedPriority: 'HIGH',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        summary: 'Printer is broken',
        description: 'The printer on the 3rd floor is jammed.',
        requestedPriority: 'HIGH',
      },
    });
  });

  it('collects one field error per rejected field, not just the first', () => {
    const result = validateTicketFields({
      summary: 'abcd', // too short
      description: 'too short', // too short
      requestedPriority: 'URGENT', // invalid
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const fields = result.errors.map((e) => e.field).sort();
    expect(fields).toEqual(['description', 'requestedPriority', 'summary']);
    for (const error of result.errors) {
      expect(typeof error.message).toBe('string');
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('reports only the fields that actually fail', () => {
    const result = validateTicketFields({
      summary: 'A valid summary',
      description: 'a'.repeat(19), // too short
      requestedPriority: 'MEDIUM',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ field: 'description', message: expect.any(String) }]);
  });
});

describe('parseTicketListQuery (UNIT-05)', () => {
  it('missing params fall back to defaults: createdAt, desc, page 1, pageSize 10', () => {
    const result = parseTicketListQuery({});
    expect(result).toEqual({
      ok: true,
      value: {
        search: undefined,
        categoryId: undefined,
        priority: undefined,
        status: undefined,
        sort: 'createdAt',
        order: 'desc',
        page: 1,
        pageSize: 10,
      },
    });
  });

  it('pageSize=7 is rejected (not one of 10, 20, 50) — not silently coerced to a default', () => {
    const result = parseTicketListQuery({ pageSize: '7' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ field: 'pageSize', message: expect.any(String) }]);
  });

  it('sort=bogus is rejected (not one of createdAt, updatedAt, ticketNumber)', () => {
    const result = parseTicketListQuery({ sort: 'bogus' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ field: 'sort', message: expect.any(String) }]);
  });

  it('blank/whitespace-only search is ignored, not an error (BR-16)', () => {
    expect(parseTicketListQuery({ search: '' })).toEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ search: undefined }) })
    );
    expect(parseTicketListQuery({ search: '   ' })).toEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ search: undefined }) })
    );
  });

  it('trims a non-blank search value', () => {
    const result = parseTicketListQuery({ search: '  vpn  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.search).toBe('vpn');
  });

  it('accepts every valid pageSize (10, 20, 50)', () => {
    for (const pageSize of [10, 20, 50]) {
      const result = parseTicketListQuery({ pageSize: String(pageSize) });
      expect(result.ok, String(pageSize)).toBe(true);
      if (!result.ok) return;
      expect(result.value.pageSize).toBe(pageSize);
    }
  });

  it('page must be a positive integer: 0, -1, and "1.5" are all rejected', () => {
    for (const page of ['0', '-1', '1.5']) {
      const result = parseTicketListQuery({ page });
      expect(result.ok, page).toBe(false);
      if (result.ok) return;
      expect(result.errors).toEqual([{ field: 'page', message: expect.any(String) }]);
    }
  });

  it('categoryId must be digits-only and within int4 range', () => {
    expect(parseTicketListQuery({ categoryId: 'abc' }).ok).toBe(false);
    expect(parseTicketListQuery({ categoryId: '-1' }).ok).toBe(false);

    const tooLarge = parseTicketListQuery({ categoryId: '99999999999' });
    expect(tooLarge.ok).toBe(false);
    if (tooLarge.ok) return;
    expect(tooLarge.errors).toEqual([{ field: 'categoryId', message: expect.any(String) }]);
  });

  it('priority and status are validated against their enums', () => {
    expect(parseTicketListQuery({ priority: 'SUPER' }).ok).toBe(false);
    expect(parseTicketListQuery({ priority: 'low' }).ok).toBe(false); // case-sensitive
    expect(parseTicketListQuery({ priority: 'HIGH' })).toEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ priority: 'HIGH' }) })
    );

    expect(parseTicketListQuery({ status: 'CLOSED' }).ok).toBe(false);
    expect(parseTicketListQuery({ status: 'NEW' })).toEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ status: 'NEW' }) })
    );
  });

  it('order is validated against asc/desc', () => {
    expect(parseTicketListQuery({ order: 'sideways' }).ok).toBe(false);
    expect(parseTicketListQuery({ order: 'asc' })).toEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ order: 'asc' }) })
    );
  });

  it('a repeated param (parsed as an array) is rejected rather than silently collapsed to one value', () => {
    const result = parseTicketListQuery({ sort: ['createdAt', 'updatedAt'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ field: 'sort', message: expect.any(String) }]);
  });

  it('collects every rejected param at once, not just the first', () => {
    const result = parseTicketListQuery({ pageSize: '7', sort: 'bogus', page: '0' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.errors.map((e) => e.field).sort();
    expect(fields).toEqual(['page', 'pageSize', 'sort']);
  });
});
