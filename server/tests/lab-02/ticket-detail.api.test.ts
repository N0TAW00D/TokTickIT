import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import type { Priority } from '../../src/validation/ticketFields.js';

// Covers docs/lab-02/api-spec.md §3.3 (GET /api/tickets/:id) and tests.md
// API-19, API-20, API-21. reset-db.ts (tests/setup/reset-db.ts) truncates
// Ticket/Attachment/TicketCounter before every test in this file, so each
// test starts from an empty Ticket table.
//
// Fixtures are seeded directly via `prisma.ticket.create`/`prisma.attachment.create`
// (bypassing POST /api/tickets and POST /api/tickets/:id/attachments) so a
// soft-removed attachment can be constructed without the `DELETE
// /api/attachments/:id` endpoint, which is being built on a different branch
// and is not available here.

let categoryId: number;
let relatedSystemId: number;
let requesterAId: number;
let requesterBId: number;

let ticketSeq = 0;

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const requesters = await prisma.requesterUser.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' },
    take: 2,
  });

  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
  requesterAId = requesters[0]!.id;
  requesterBId = requesters[1]!.id;
});

interface SeedTicketOverrides {
  requesterId?: number;
  categoryId?: number;
  relatedSystemId?: number;
  ticketNumber?: string;
  summary?: string;
  description?: string;
  requestedPriority?: Priority;
}

async function seedTicket(overrides: SeedTicketOverrides = {}) {
  ticketSeq += 1;
  return prisma.ticket.create({
    data: {
      ticketNumber: overrides.ticketNumber ?? `TKT-2026-${String(ticketSeq).padStart(6, '0')}`,
      requesterId: overrides.requesterId ?? requesterAId,
      categoryId: overrides.categoryId ?? categoryId,
      relatedSystemId: overrides.relatedSystemId ?? relatedSystemId,
      summary: overrides.summary ?? `Seed ticket ${ticketSeq}`,
      description: overrides.description ?? 'x'.repeat(25),
      requestedPriority: overrides.requestedPriority ?? 'MEDIUM',
      status: 'NEW',
    },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      category: { select: { id: true, name: true } },
      relatedSystem: { select: { id: true, name: true } },
    },
  });
}

interface SeedAttachmentOverrides {
  isRemoved?: boolean;
  removedReason?: string;
  removedById?: number;
}

async function seedAttachment(ticketId: number, overrides: SeedAttachmentOverrides = {}) {
  const isRemoved = overrides.isRemoved ?? false;
  return prisma.attachment.create({
    data: {
      ticketId,
      originalFilename: 'battery-report.pdf',
      storedFilename: `${randomUUID()}.pdf`,
      mimeType: 'application/pdf',
      fileSize: 249184,
      isRemoved,
      removedAt: isRemoved ? new Date('2026-09-01T09:02:00.000Z') : null,
      removedReason: isRemoved ? (overrides.removedReason ?? 'Uploaded the wrong screenshot') : null,
      removedById: isRemoved ? (overrides.removedById ?? null) : null,
    },
  });
}

function getTicket(ticketId: number | string, requesterId?: number) {
  const req = request(app).get(`/api/tickets/${ticketId}`);
  return requesterId === undefined ? req : req.set('X-Requester-Id', String(requesterId));
}

describe('GET /api/tickets/:id', () => {
  it('API-19: owned ticket returns 200 with full header fields matching stored values and an attachments array', async () => {
    const ticket = await seedTicket({ summary: 'Laptop battery drains quickly' });
    const active = await seedAttachment(ticket.id, { isRemoved: false });

    const res = await getTicket(ticket.id, requesterAId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requester: { id: ticket.requester.id, name: ticket.requester.name, email: ticket.requester.email },
      category: { id: ticket.category.id, name: ticket.category.name },
      relatedSystem: { id: ticket.relatedSystem.id, name: ticket.relatedSystem.name },
      requestedPriority: ticket.requestedPriority,
      status: ticket.status,
      summary: ticket.summary,
      description: ticket.description,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      attachments: [
        {
          id: active.id,
          originalFilename: active.originalFilename,
          mimeType: active.mimeType,
          fileSize: active.fileSize,
          isRemoved: false,
          removedAt: null,
          removedReason: null,
          createdAt: active.createdAt.toISOString(),
        },
      ],
    });
  });

  it('API-19: an owned ticket with no attachments returns attachments: []', async () => {
    const ticket = await seedTicket();

    const res = await getTicket(ticket.id, requesterAId);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toEqual([]);
  });

  describe('API-20: not owned / unknown — byte-identical 404 NOT_FOUND (BR-14, BR-42)', () => {
    it('an unknown id and a ticket owned by another Requester produce byte-identical 404 bodies', async () => {
      const bTicket = await seedTicket({ requesterId: requesterBId });
      const unknownId = bTicket.id + 1_000_000;

      // Sanity: unknownId really doesn't exist, so this is a genuine
      // "unknown" case rather than an accidental collision with a real row.
      const exists = await prisma.ticket.findUnique({ where: { id: unknownId } });
      expect(exists).toBeNull();

      const notOwnedRes = await getTicket(bTicket.id, requesterAId);
      const unknownRes = await getTicket(unknownId, requesterAId);

      expect(notOwnedRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(notOwnedRes.body.error).toBe('NOT_FOUND');
      // The actual byte-identical claim: not just "both 404", but the same
      // status code and the exact same JSON body, key-for-key, value-for-value.
      expect(notOwnedRes.body).toEqual(unknownRes.body);
      expect(JSON.stringify(notOwnedRes.body)).toBe(JSON.stringify(unknownRes.body));
      expect('fields' in notOwnedRes.body).toBe(false);
    });

    it("Requester B cannot read Requester A's ticket (data-disclosure guard, AC-37)", async () => {
      const aTicket = await seedTicket({ requesterId: requesterAId, summary: "A's private ticket" });

      const res = await getTicket(aTicket.id, requesterBId);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      // The response must never carry A's data.
      expect(res.body).not.toHaveProperty('summary');
      expect(JSON.stringify(res.body)).not.toContain("A's private ticket");
    });

    it('a non-integer :id is 404 NOT_FOUND, not 400 (§1.4)', async () => {
      const res = await getTicket('abc', requesterAId);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('an id beyond int4 range is 404, not a 500 (§1.4, out-of-range bound)', async () => {
      const res = await getTicket('99999999999999', requesterAId);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('missing/unknown/inactive X-Requester-Id returns 400 before ownership is ever checked', async () => {
      const ticket = await seedTicket();

      const missing = await getTicket(ticket.id);
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe('MISSING_REQUESTER');

      const unknown = await getTicket(ticket.id, 999999);
      expect(unknown.status).toBe(400);
      expect(unknown.body.error).toBe('INVALID_REQUESTER');
    });
  });

  it('API-21: lists a removed attachment as metadata — isRemoved:true, removedAt, removedReason set, and storedFilename is never leaked', async () => {
    const ticket = await seedTicket();
    const active = await seedAttachment(ticket.id, { isRemoved: false });
    const removed = await seedAttachment(ticket.id, { isRemoved: true, removedReason: 'Uploaded the wrong screenshot' });

    const res = await getTicket(ticket.id, requesterAId);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(2);

    const removedBody = (res.body.attachments as Array<Record<string, unknown>>).find(
      (a) => a.id === removed.id
    );
    expect(removedBody).toBeDefined();
    expect(removedBody).toEqual({
      id: removed.id,
      originalFilename: removed.originalFilename,
      mimeType: removed.mimeType,
      fileSize: removed.fileSize,
      isRemoved: true,
      removedAt: removed.removedAt!.toISOString(),
      removedReason: 'Uploaded the wrong screenshot',
      createdAt: removed.createdAt.toISOString(),
    });

    const activeBody = (res.body.attachments as Array<Record<string, unknown>>).find((a) => a.id === active.id);
    expect(activeBody).toEqual({
      id: active.id,
      originalFilename: active.originalFilename,
      mimeType: active.mimeType,
      fileSize: active.fileSize,
      isRemoved: false,
      removedAt: null,
      removedReason: null,
      createdAt: active.createdAt.toISOString(),
    });

    // BR-41: storedFilename (the internal server-generated disk name) must
    // never leak, on either an active or a removed attachment. Assert the
    // exact key set as well as the field's absence — a widened `select`
    // (e.g. spreading the whole row) would add this key and fail here even
    // if every other field still matched.
    for (const attachment of res.body.attachments as Array<Record<string, unknown>>) {
      expect(attachment).not.toHaveProperty('storedFilename');
      expect(attachment).not.toHaveProperty('removedById');
      expect(attachment).not.toHaveProperty('ticketId');
      expect(Object.keys(attachment).sort()).toEqual(
        ['createdAt', 'fileSize', 'id', 'isRemoved', 'mimeType', 'originalFilename', 'removedAt', 'removedReason'].sort()
      );
    }

    // Confirm storedFilename genuinely exists on the underlying row (so the
    // assertions above are proving it's excluded from the response, not
    // merely absent from the fixture).
    const rawRemoved = await prisma.attachment.findUniqueOrThrow({ where: { id: removed.id } });
    expect(typeof rawRemoved.storedFilename).toBe('string');
    expect(rawRemoved.storedFilename.length).toBeGreaterThan(0);
  });
});
