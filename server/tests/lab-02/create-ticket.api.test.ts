import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';

// Covers docs/lab-02/api-spec.md §3.1 (POST /api/tickets) and
// tests.md API-05..API-09, API-32. reset-db.ts (tests/setup/reset-db.ts)
// truncates Ticket/Attachment/TicketCounter before every test in this file
// (and every other file sharing the test DB), so each test starts from an
// empty Ticket table and a fresh per-year counter — the sequence assertions
// below (e.g. "000001") rely on that.
//
// All requests below go through one shared, already-listening server
// (tests/setup/http-server.ts) rather than `request(app)` — see that file
// for why. This is the file where it matters most: API-09 fires 15
// requests concurrently via Promise.all.
const testServer = useTestServer(app);

let activeCategoryId: number;
let activeCategoryName: string;
let activeRelatedSystemId: number;
let activeRelatedSystemName: string;
let activeRequesterId: number;
let inactiveRequesterId: number;

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const requester = await prisma.requesterUser.findFirstOrThrow({ where: { isActive: true } });
  const inactiveRequester = await prisma.requesterUser.findFirstOrThrow({ where: { isActive: false } });

  activeCategoryId = category.id;
  activeCategoryName = category.name;
  activeRelatedSystemId = relatedSystem.id;
  activeRelatedSystemName = relatedSystem.name;
  activeRequesterId = requester.id;
  inactiveRequesterId = inactiveRequester.id;
});

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: activeCategoryId,
    relatedSystemId: activeRelatedSystemId,
    requestedPriority: 'MEDIUM',
    summary: 'Laptop battery drains quickly',
    description: 'My laptop battery is draining much faster than usual even when the system is idle.',
    ...overrides,
  };
}

describe('POST /api/tickets', () => {
  it('API-05: happy path returns 201 with the full ticket shape', async () => {
    const res = await request(testServer.server)
      .post('/api/tickets')
      .set('X-Requester-Id', String(activeRequesterId))
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^TKT-\d{4}-000001$/);
    expect(res.body.status).toBe('NEW');
    expect(typeof res.body.id).toBe('number');
    expect(res.body.requester).toEqual({
      id: activeRequesterId,
      name: expect.any(String),
      email: expect.any(String),
    });
    expect(res.body.category).toEqual({ id: activeCategoryId, name: activeCategoryName });
    expect(res.body.relatedSystem).toEqual({ id: activeRelatedSystemId, name: activeRelatedSystemName });
    expect(res.body.requestedPriority).toBe('MEDIUM');
    expect(res.body.summary).toBe('Laptop battery drains quickly');
    expect(res.body.attachments).toEqual([]);
    expect(res.body.createdAt).toBe(res.body.updatedAt);
    expect(() => {
      if (Number.isNaN(new Date(res.body.createdAt).getTime())) throw new Error('not a date');
    }).not.toThrow();

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.requesterId).toBe(activeRequesterId);
    expect(stored.status).toBe('NEW');
  });

  it('API-06: field validation failures return 400 VALIDATION_FAILED with fields[]; nothing persisted', async () => {
    const before = await prisma.ticket.count();

    const cases: Array<[string, Record<string, unknown>]> = [
      ['missing summary', { summary: undefined }],
      ['summary too short (4 chars)', { summary: 'abcd' }],
      ['summary too long (141 chars)', { summary: 'a'.repeat(141) }],
      ['description too short (19 chars)', { description: 'a'.repeat(19) }],
      ['bad priority', { requestedPriority: 'URGENT' }],
    ];

    for (const [label, overrides] of cases) {
      const res = await request(testServer.server)
        .post('/api/tickets')
        .set('X-Requester-Id', String(activeRequesterId))
        .send(validBody(overrides));

      expect(res.status, label).toBe(400);
      expect(res.body.error, label).toBe('VALIDATION_FAILED');
      expect(Array.isArray(res.body.fields), label).toBe(true);
      expect((res.body.fields as unknown[]).length, label).toBeGreaterThan(0);
      for (const fieldError of res.body.fields as Array<Record<string, unknown>>) {
        expect(typeof fieldError.field, label).toBe('string');
        expect(typeof fieldError.message, label).toBe('string');
      }
    }

    const after = await prisma.ticket.count();
    expect(after).toBe(before);
  });

  it('API-07: unknown or inactive categoryId/relatedSystemId return 404 NOT_FOUND; nothing persisted', async () => {
    const before = await prisma.ticket.count();
    const unknownId = 999_999;

    const unknownCategoryRes = await request(testServer.server)
      .post('/api/tickets')
      .set('X-Requester-Id', String(activeRequesterId))
      .send(validBody({ categoryId: unknownId }));
    expect(unknownCategoryRes.status).toBe(404);
    expect(unknownCategoryRes.body.error).toBe('NOT_FOUND');

    const unknownRelatedSystemRes = await request(testServer.server)
      .post('/api/tickets')
      .set('X-Requester-Id', String(activeRequesterId))
      .send(validBody({ relatedSystemId: unknownId }));
    expect(unknownRelatedSystemRes.status).toBe(404);
    expect(unknownRelatedSystemRes.body.error).toBe('NOT_FOUND');

    // No inactive Category/RelatedSystem is seeded (only an inactive
    // Requester is), so this creates one, exercises it, then deletes it —
    // reset-db.ts never truncates these tables, so leaving it behind would
    // permanently change the seeded set for every other test/file.
    const inactiveCategory = await prisma.category.create({
      data: { name: '__api-07-temp-inactive-category__', isActive: false },
    });
    try {
      const res = await request(testServer.server)
        .post('/api/tickets')
        .set('X-Requester-Id', String(activeRequesterId))
        .send(validBody({ categoryId: inactiveCategory.id }));
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    } finally {
      await prisma.category.delete({ where: { id: inactiveCategory.id } });
    }

    const inactiveRelatedSystem = await prisma.relatedSystem.create({
      data: { name: '__api-07-temp-inactive-related-system__', isActive: false },
    });
    try {
      const res = await request(testServer.server)
        .post('/api/tickets')
        .set('X-Requester-Id', String(activeRequesterId))
        .send(validBody({ relatedSystemId: inactiveRelatedSystem.id }));
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    } finally {
      await prisma.relatedSystem.delete({ where: { id: inactiveRelatedSystem.id } });
    }

    const after = await prisma.ticket.count();
    expect(after).toBe(before);
  });

  it('API-08: requester header rules; a requesterId in the body is ignored (A-01)', async () => {
    const missingHeaderRes = await request(testServer.server).post('/api/tickets').send(validBody());
    expect(missingHeaderRes.status).toBe(400);
    expect(missingHeaderRes.body.error).toBe('MISSING_REQUESTER');

    const unknownHeaderRes = await request(testServer.server)
      .post('/api/tickets')
      .set('X-Requester-Id', '999999')
      .send(validBody());
    expect(unknownHeaderRes.status).toBe(400);
    expect(unknownHeaderRes.body.error).toBe('INVALID_REQUESTER');

    const inactiveHeaderRes = await request(testServer.server)
      .post('/api/tickets')
      .set('X-Requester-Id', String(inactiveRequesterId))
      .send(validBody());
    expect(inactiveHeaderRes.status).toBe(400);
    expect(inactiveHeaderRes.body.error).toBe('INVALID_REQUESTER');

    const ignoredBodyRequesterRes = await request(testServer.server)
      .post('/api/tickets')
      .set('X-Requester-Id', String(activeRequesterId))
      .send(validBody({ requesterId: inactiveRequesterId }));
    expect(ignoredBodyRequesterRes.status).toBe(201);
    expect(ignoredBodyRequesterRes.body.requester.id).toBe(activeRequesterId);
  });

  it('API-09: 15 parallel creates yield 15 unique ticket numbers with a contiguous sequence', async () => {
    const responses = await Promise.all(
      Array.from({ length: 15 }, () =>
        request(testServer.server)
          .post('/api/tickets')
          .set('X-Requester-Id', String(activeRequesterId))
          .send(validBody())
      )
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }

    const ticketNumbers = responses.map((res) => res.body.ticketNumber as string);

    for (const ticketNumber of ticketNumbers) {
      expect(ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);
    }

    expect(new Set(ticketNumbers).size).toBe(15);

    const sequences = ticketNumbers
      .map((ticketNumber) => Number(ticketNumber.split('-')[2]))
      .sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));

    const persistedCount = await prisma.ticket.count();
    expect(persistedCount).toBe(15);
  });

  it('API-32: an unexpected error returns a generic 500 body with no stack/SQL/path leaked; nothing persisted', async () => {
    const before = await prisma.ticket.count();

    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(
        new Error('simulated failure at /Users/dev/server/src/services/createTicket.ts:118 — SELECT * FROM "Ticket"')
      );

    try {
      const res = await request(testServer.server)
        .post('/api/tickets')
        .set('X-Requester-Id', String(activeRequesterId))
        .send(validBody());

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'INTERNAL', message: expect.any(String) });

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('/Users');
      expect(serialized).not.toContain('.ts');
      expect(serialized.toLowerCase()).not.toContain('select ');
      expect(serialized).not.toMatch(/at \S+:\d+:\d+/); // no stack-trace frame
    } finally {
      spy.mockRestore();
    }

    const after = await prisma.ticket.count();
    expect(after).toBe(before);
  });

  // api-spec.md §1.4a/§3.1 list 400 MALFORMED_BODY for "Body is not valid
  // JSON / not an object", but tests.md has no API-xx row for it, so none of
  // the above cover it. These four cases are implemented in two places —
  // the JSON parse-error handler in src/app.ts (invalid JSON syntax) and the
  // isPlainRequestBody guard in src/routes/tickets.ts (valid JSON that isn't
  // a plain object, or no body at all) — and are added here to close that
  // gap without inventing a new API-xx id.
  describe('malformed request body (§1.3, §1.4a) — no tests.md API-xx row', () => {
    it('invalid JSON syntax with Content-Type: application/json returns 400 MALFORMED_BODY (app.ts parse-error handler)', async () => {
      const before = await prisma.ticket.count();

      const res = await request(testServer.server)
        .post('/api/tickets')
        .set('X-Requester-Id', String(activeRequesterId))
        .set('Content-Type', 'application/json')
        .send('{"summary": ');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MALFORMED_BODY');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
      expect('fields' in res.body).toBe(false);

      const after = await prisma.ticket.count();
      expect(after).toBe(before);
    });

    it('a valid JSON array body returns 400 MALFORMED_BODY (isPlainRequestBody guard)', async () => {
      const before = await prisma.ticket.count();

      const res = await request(testServer.server)
        .post('/api/tickets')
        .set('X-Requester-Id', String(activeRequesterId))
        .set('Content-Type', 'application/json')
        .send('[1,2,3]');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MALFORMED_BODY');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
      expect('fields' in res.body).toBe(false);

      const after = await prisma.ticket.count();
      expect(after).toBe(before);
    });

    it('a bare JSON primitive body returns 400 MALFORMED_BODY (isPlainRequestBody guard)', async () => {
      const before = await prisma.ticket.count();

      const res = await request(testServer.server)
        .post('/api/tickets')
        .set('X-Requester-Id', String(activeRequesterId))
        .set('Content-Type', 'application/json')
        .send('42');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MALFORMED_BODY');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
      expect('fields' in res.body).toBe(false);

      const after = await prisma.ticket.count();
      expect(after).toBe(before);
    });

    it('no body and no Content-Type returns 400 MALFORMED_BODY (isPlainRequestBody guard)', async () => {
      const before = await prisma.ticket.count();

      const res = await request(testServer.server).post('/api/tickets').set('X-Requester-Id', String(activeRequesterId));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('MALFORMED_BODY');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
      expect('fields' in res.body).toBe(false);

      const after = await prisma.ticket.count();
      expect(after).toBe(before);
    });
  });
});
