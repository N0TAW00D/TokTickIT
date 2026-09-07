import { describe, expect, it } from 'vitest';
import {
  validateDescription,
  validateRequestedPriority,
  validateSummary,
  validateTicketFields,
} from '../../src/validation/ticketFields.js';
import { parseTicketListQuery } from '../../src/validation/ticketListQuery.js';
import {
  safeOriginalFilename,
  sniffMimeType,
  validateAttachmentType,
} from '../../src/validation/attachmentFile.js';

// Covers docs/lab-02/specification.md §4-fields, A-03 and tests.md UNIT-04,
// plus (below) UNIT-05, the GET /api/tickets query-param parser (#18).
//
// UNIT-06 (attachment type guard + safe filename, #17 slice 9a) is covered
// in the `describe` blocks below as well.

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

  it('UNIT-05 (extended): a present-but-blank value on any non-search param is 400, not defaulted (BR-19, FR-29)', () => {
    // §3.2's table gives the "blank ⇒ ignored" exemption to `search`
    // alone (BR-16); every other param's rule is "must be X ⇒ else 400",
    // and a blank string is not a valid integer or enum member. Silently
    // defaulting a *present* blank value would be exactly the coercion
    // FR-29 forbids — this must not regress to the old (wrong) behavior
    // where blank was read as "not specified" for every param.
    const blankCases: Array<[field: string, query: Record<string, string>]> = [
      ['page', { page: '' }],
      ['page', { page: '   ' }],
      ['pageSize', { pageSize: '' }],
      ['priority', { priority: '' }],
      ['status', { status: '' }],
      ['sort', { sort: '' }],
      ['order', { order: '' }],
      ['categoryId', { categoryId: '' }],
    ];

    for (const [field, query] of blankCases) {
      const result = parseTicketListQuery(query);
      expect(result.ok, JSON.stringify(query)).toBe(false);
      if (result.ok) continue;
      expect(result.errors.map((e) => e.field), JSON.stringify(query)).toEqual([field]);
    }
  });

  it('UNIT-05 (extended): an absent param still takes its documented default, unaffected by the blank-param fix', () => {
    const result = parseTicketListQuery({ page: undefined, pageSize: undefined, priority: undefined });
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

// UNIT-06 (docs/lab-02/tests.md): attachment type guard + safe filename
// (specification.md BR-21, BR-29; api-spec.md §4.1).
describe('validateAttachmentType (UNIT-06)', () => {
  it('rejects a .exe file (extension not in the allowed set at all)', () => {
    const result = validateAttachmentType('virus.exe', 'application/octet-stream');
    expect(result.ok).toBe(false);
  });

  it('rejects a .txt file declaring text/plain', () => {
    const result = validateAttachmentType('notes.txt', 'text/plain');
    expect(result.ok).toBe(false);
  });

  it('accepts report.pdf declaring application/pdf', () => {
    const result = validateAttachmentType('report.pdf', 'application/pdf');
    expect(result).toEqual({ ok: true, value: { mimeType: 'application/pdf', extension: 'pdf' } });
  });

  it('accepts photo.jpg / photo.jpeg declaring image/jpeg, normalizing to the .jpg extension', () => {
    expect(validateAttachmentType('photo.jpg', 'image/jpeg')).toEqual({
      ok: true,
      value: { mimeType: 'image/jpeg', extension: 'jpg' },
    });
    expect(validateAttachmentType('photo.jpeg', 'image/jpeg')).toEqual({
      ok: true,
      value: { mimeType: 'image/jpeg', extension: 'jpg' },
    });
  });

  it('accepts icon.png / image.webp declaring their matching mime types', () => {
    expect(validateAttachmentType('icon.png', 'image/png')).toEqual({
      ok: true,
      value: { mimeType: 'image/png', extension: 'png' },
    });
    expect(validateAttachmentType('image.webp', 'image/webp')).toEqual({
      ok: true,
      value: { mimeType: 'image/webp', extension: 'webp' },
    });
  });

  it('rejects an extension/content mismatch: a .pdf name whose detected type is image/png (BR-21, API-22)', () => {
    // This is the exact "renamed" scenario API-22 exercises against the
    // live route: the route passes `sniffMimeType(buffer)` — the detected
    // content type — as the second argument here, not the client's
    // declared Content-Type, so a PNG's bytes renamed to a .pdf filename
    // fail this comparison even though the extension alone looks fine.
    const result = validateAttachmentType('renamed.pdf', 'image/png');
    expect(result.ok).toBe(false);
  });

  it('rejects a file with no extension', () => {
    expect(validateAttachmentType('noextension', 'application/pdf').ok).toBe(false);
  });
});

describe('sniffMimeType (UNIT-06)', () => {
  it('detects a JPEG from its FF D8 FF magic bytes', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe('image/jpeg');
  });

  it('detects a PNG from its 8-byte signature', () => {
    expect(
      sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))
    ).toBe('image/png');
  });

  it('detects a WEBP from its RIFF....WEBP container', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // size field, not part of the signature
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(sniffMimeType(buf)).toBe('image/webp');
  });

  it('detects a PDF from its %PDF- header', () => {
    expect(sniffMimeType(Buffer.from('%PDF-1.4\n%...', 'ascii'))).toBe('application/pdf');
  });

  it('returns null for unrecognized content (e.g. plain text or a PNG-renamed-.pdf payload)', () => {
    expect(sniffMimeType(Buffer.from('just some plain text', 'ascii'))).toBeNull();
  });

  it('returns null for a buffer too short to contain any signature', () => {
    expect(sniffMimeType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
  });
});

describe('safeOriginalFilename (UNIT-06, BR-29)', () => {
  it('strips Unix path components, keeping only the final segment', () => {
    expect(safeOriginalFilename('../../etc/passwd')).toBe('passwd');
  });

  it('strips Windows-style path components too', () => {
    expect(safeOriginalFilename('..\\..\\etc\\passwd')).toBe('passwd');
  });

  it('leaves a plain filename with no path components untouched', () => {
    expect(safeOriginalFilename('battery-report.pdf')).toBe('battery-report.pdf');
  });

  it('truncates a filename longer than 255 characters', () => {
    const longName = 'a'.repeat(300) + '.pdf';
    const result = safeOriginalFilename(longName);
    expect(result.length).toBe(255);
    expect(result).toBe(longName.slice(0, 255));
  });

  it('a path-traversal name yields a stored-safe originalFilename with no path and length <= 255', () => {
    const result = safeOriginalFilename('../../etc/passwd');
    expect(result).not.toMatch(/[/\\]/);
    expect(result.length).toBeLessThanOrEqual(255);
  });
});
