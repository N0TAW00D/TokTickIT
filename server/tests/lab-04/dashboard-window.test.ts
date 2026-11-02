import { describe, expect, it } from 'vitest';
import {
  BANGKOK_TIME_ZONE,
  bangkokDayStart,
  windowStart,
} from '../../src/services/dashboardWindow.js';
import { parseTicketListQuery } from '../../src/validation/ticketListQuery.js';
import { parseStaffTicketQueueQuery } from '../../src/validation/staffTicketQueueQuery.js';

// Pure, DB-free. Vitest pins TZ=UTC, so a window computed with the process
// time zone instead of Asia/Bangkok would be wrong here (BR-22).

describe('UNIT-07: Bangkok window start', () => {
  it('UNIT-07: 16:59:59Z is still the previous Bangkok day, 17:00:00Z is the next', () => {
    // 2026-10-12T16:59:59Z = 23:59:59 on 12 Oct in Bangkok -> window starts 6 Oct 00:00 Bangkok.
    expect(windowStart(new Date('2026-10-12T16:59:59.000Z')).toISOString()).toBe('2026-10-05T17:00:00.000Z');
    // One second later it is 13 Oct 00:00:00 in Bangkok -> window starts 7 Oct 00:00 Bangkok.
    expect(windowStart(new Date('2026-10-12T17:00:00.000Z')).toISOString()).toBe('2026-10-06T17:00:00.000Z');
  });

  it('UNIT-07: matches the api-spec example and the start of today', () => {
    expect(windowStart(new Date('2026-10-12T05:00:00.000Z')).toISOString()).toBe('2026-10-05T17:00:00.000Z');
    expect(bangkokDayStart(new Date('2026-10-12T16:59:59.000Z')).toISOString()).toBe('2026-10-11T17:00:00.000Z');
    expect(bangkokDayStart(new Date('2026-10-12T17:00:00.000Z')).toISOString()).toBe('2026-10-12T17:00:00.000Z');
    expect(BANGKOK_TIME_ZONE).toBe('Asia/Bangkok');
  });

  it('UNIT-07: no DST shift across a year of dates, always exactly 6 days before today in a fixed +7 offset', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 366; i++) {
      const now = new Date(start + i * 86_400_000 + 12_345_678);
      const w = windowStart(now);
      expect(w.getUTCHours()).toBe(17);
      expect(w.getUTCMinutes()).toBe(0);
      expect(bangkokDayStart(now).getTime() - w.getTime()).toBe(6 * 86_400_000);
    }
  });
});

describe('UNIT-11: drill-down query parsers', () => {
  const fieldsOf = (r: { ok: boolean; errors?: { field: string }[] }) => (r.ok ? [] : r.errors!.map((e) => e.field));

  it('UNIT-11: My Tickets accepts scope and all eight statuses', () => {
    for (const scope of ['open', 'recent', 'recently-resolved']) {
      expect(parseTicketListQuery({ scope })).toEqual(
        expect.objectContaining({ ok: true, value: expect.objectContaining({ scope }) })
      );
    }
    for (const status of ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_REQUESTER', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED']) {
      expect(parseTicketListQuery({ status })).toEqual(
        expect.objectContaining({ ok: true, value: expect.objectContaining({ status }) })
      );
    }
    const none = parseTicketListQuery({});
    expect(none.ok && none.value.scope).toBeUndefined();
  });

  it('UNIT-11: My Tickets rejects unknown scope and status=BOGUS with INVALID_QUERY field entries', () => {
    expect(fieldsOf(parseTicketListQuery({ scope: 'bogus' }))).toEqual(['scope']);
    expect(fieldsOf(parseTicketListQuery({ scope: '' }))).toEqual(['scope']);
    expect(fieldsOf(parseTicketListQuery({ status: 'BOGUS' }))).toEqual(['status']);
    expect(fieldsOf(parseTicketListQuery({ scope: 'x', status: 'BOGUS' })).sort()).toEqual(['scope', 'status']);
  });

  it('UNIT-11: staff queue parses scope, myActions=true and followUp=true', () => {
    const r = parseStaffTicketQueueQuery({ scope: 'open', myActions: 'true', followUp: 'true', status: 'CLOSED' });
    expect(r).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ scope: 'open', myActions: true, followUp: true, status: 'CLOSED' }),
      })
    );
    expect(parseStaffTicketQueueQuery({ scope: 'recent' })).toEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ scope: 'recent' }) })
    );
    const none = parseStaffTicketQueueQuery({});
    expect(none.ok && [none.value.scope, none.value.myActions, none.value.followUp]).toEqual([undefined, undefined, undefined]);
  });

  it('UNIT-11: staff queue rejects myActions=false, followUp=false, unknown scope (incl. recently-resolved), status=BOGUS', () => {
    expect(fieldsOf(parseStaffTicketQueueQuery({ myActions: 'false' }))).toEqual(['myActions']);
    expect(fieldsOf(parseStaffTicketQueueQuery({ followUp: 'false' }))).toEqual(['followUp']);
    expect(fieldsOf(parseStaffTicketQueueQuery({ myActions: '' }))).toEqual(['myActions']);
    expect(fieldsOf(parseStaffTicketQueueQuery({ scope: 'bogus' }))).toEqual(['scope']);
    expect(fieldsOf(parseStaffTicketQueueQuery({ scope: 'recently-resolved' }))).toEqual(['scope']);
    expect(fieldsOf(parseStaffTicketQueueQuery({ status: 'BOGUS' }))).toEqual(['status']);
  });
});
