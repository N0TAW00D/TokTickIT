import { describe, expect, it } from 'vitest';
import {
  validateDescription,
  validateRequestedPriority,
  validateSummary,
  validateTicketFields,
} from '../../src/validation/ticketFields.js';

// Covers docs/lab-02/specification.md §4-fields, A-03 and tests.md UNIT-04.
//
// Out of scope here (per the slice 8b brief): UNIT-05 (list query-param
// parser, #18) and UNIT-06 (attachment type guard + safe filename, #17).

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
