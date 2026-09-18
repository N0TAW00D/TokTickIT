import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';
import type { Priority } from '../../src/validation/ticketFields.js';

// PATCH /api/tickets/:id/it-priority — docs/lab-03/api-spec.md §5.2 (FR-22;
// BR-21, BR-22; AC-37, AC-68).
//
// The one staff-write route both IT Staff AND Administrator may call (every
// other staff-write route — owner, status, notes — is IT-Staff-only); a
// Requester still gets 404, same §1.4 collapse as owner/status.
//
// Fixtures reuse the seeded IT Staff/Administrator/Requester accounts
// (server/prisma/seed.ts, LOCAL_DEV_PASSWORD), same convention as
// ticket-owner.api.test.ts — reset-db.ts truncates Ticket/Attachment/
// TicketCounter/Session (never User) before every test, and
// vitest.config.ts's `fileParallelism: false` runs every test file serially,
// so reusing the seeded Users across tests/files is safe.
//
// Tickets are seeded directly via `prisma.ticket.create`, bypassing
// POST /api/tickets and this very route.

const testServer = useTestServer(app);

let categoryId: number;
let relatedSystemId: number;
let requesterAId: number;
let requesterAEmail: string;
let requesterBEmail: string;
let staffAEmail: string;
let adminEmail: string;

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const requesters = await prisma.user.findMany({
    where: { isActive: true, role: 'REQUESTER' },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const staff = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'IT_STAFF' } });
  const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });

  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
  requesterAId = requesters[0]!.id;
  requesterAEmail = requesters[0]!.email;
  requesterBEmail = requesters[1]!.email;
  staffAEmail = staff.email;
  adminEmail = admin.email;
});

function extractSessionCookiePair(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!raw) {
    throw new Error('Response carried no toktickit.sid cookie');
  }
  return raw.split(';')[0];
}

async function loginAndGetCookie(email: string, password: string = LOCAL_DEV_PASSWORD): Promise<string> {
  const res = await request(testServer.server)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password });
  expect(res.status, 'test fixture login must succeed').toBe(200);
  return extractSessionCookiePair(res);
}

// reset-db.ts truncates Session before every test, so fresh cookies must be
// obtained per test, not once in beforeAll.
let staffCookie: string;
let adminCookie: string;
let requesterACookie: string;
let requesterBCookie: string;

beforeEach(async () => {
  staffCookie = await loginAndGetCookie(staffAEmail);
  adminCookie = await loginAndGetCookie(adminEmail);
  requesterACookie = await loginAndGetCookie(requesterAEmail);
  requesterBCookie = await loginAndGetCookie(requesterBEmail);
});

interface SeedTicketOverrides {
  requesterId?: number;
  ticketNumber?: string;
  summary?: string;
  requestedPriority?: Priority;
  itPriority?: Priority;
}

let ticketSeq = 0;

async function seedTicket(overrides: SeedTicketOverrides = {}) {
  ticketSeq += 1;
  return prisma.ticket.create({
    data: {
      ticketNumber: overrides.ticketNumber ?? `TKT-2026-${String(ticketSeq).padStart(6, '0')}`,
      requesterId: overrides.requesterId ?? requesterAId,
      categoryId,
      relatedSystemId,
      summary: overrides.summary ?? `Seed ticket ${ticketSeq}`,
      description: 'x'.repeat(25),
      requestedPriority: overrides.requestedPriority ?? 'MEDIUM',
      itPriority: overrides.itPriority ?? overrides.requestedPriority ?? 'MEDIUM',
      status: 'NEW',
      ownerId: null,
    },
  });
}

function patchItPriority(ticketId: number | string, body: unknown, cookie?: string) {
  const req = request(testServer.server)
    .patch(`/api/tickets/${ticketId}/it-priority`)
    .set('Content-Type', 'application/json');
  const withCookie = cookie === undefined ? req : req.set('Cookie', cookie);
  return withCookie.send(body as object);
}

describe('PATCH /api/tickets/:id/it-priority (api-spec.md §5.2)', () => {
  // -------------------------------------------------------------------
  // Happy paths — IT Staff can set any of the three enum values.
  // -------------------------------------------------------------------
  it.each(['LOW', 'MEDIUM', 'HIGH'] as const)(
    'IT Staff can change itPriority to %s, 200 with the new value, requestedPriority unchanged',
    async (value) => {
      const ticket = await seedTicket({ requestedPriority: 'MEDIUM', itPriority: 'MEDIUM' });

      const res = await patchItPriority(ticket.id, { itPriority: value }, staffCookie);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(ticket.id);
      expect(res.body.itPriority).toBe(value);
      expect(res.body.requestedPriority).toBe('MEDIUM');

      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(stored.itPriority).toBe(value);
      expect(stored.requestedPriority).toBe('MEDIUM');
    },
  );

  it('the 200 response carries the full staff ticket-detail shape (same as GET /api/tickets/:id)', async () => {
    const ticket = await seedTicket({ requestedPriority: 'LOW', itPriority: 'LOW' });

    const res = await patchItPriority(ticket.id, { itPriority: 'HIGH' }, staffCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requestedPriority: 'LOW',
      itPriority: 'HIGH',
      status: 'NEW',
      summary: ticket.summary,
    });
    expect(res.body.requester).toEqual({ id: requesterAId, name: expect.any(String), email: expect.any(String) });
    expect(res.body).toHaveProperty('owner');
    expect(res.body).toHaveProperty('requesterResolvedAt');
    expect(res.body).toHaveProperty('attachments');
  });

  // -------------------------------------------------------------------
  // Administrator: the one staff-write route where BOTH roles may write.
  // -------------------------------------------------------------------
  it('Administrator can ALSO change itPriority, 200 (unlike the owner/status routes)', async () => {
    const ticket = await seedTicket({ requestedPriority: 'MEDIUM', itPriority: 'MEDIUM' });

    const res = await patchItPriority(ticket.id, { itPriority: 'HIGH' }, adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.itPriority).toBe('HIGH');
    expect(res.body.requestedPriority).toBe('MEDIUM');

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.itPriority).toBe('HIGH');
  });

  // -------------------------------------------------------------------
  // Authorization — Requester -> 404, even on their own ticket.
  // -------------------------------------------------------------------
  it('404 NOT_FOUND for a Requester attempting this, even on their own ticket', async () => {
    const ticket = await seedTicket({ requesterId: requesterAId });

    const res = await patchItPriority(ticket.id, { itPriority: 'HIGH' }, requesterACookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.itPriority).toBe('MEDIUM');
  });

  it("404 NOT_FOUND for a Requester attempting this on someone else's ticket", async () => {
    const ticket = await seedTicket({ requesterId: requesterAId });

    const res = await patchItPriority(ticket.id, { itPriority: 'HIGH' }, requesterBCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('unknown ticket id -> 404 NOT_FOUND for IT Staff', async () => {
    const ticket = await seedTicket();
    const unknownId = ticket.id + 1_000_000;

    const res = await patchItPriority(unknownId, { itPriority: 'HIGH' }, staffCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('unknown ticket id -> 404 NOT_FOUND for Administrator too', async () => {
    const ticket = await seedTicket();
    const unknownId = ticket.id + 1_000_000;

    const res = await patchItPriority(unknownId, { itPriority: 'HIGH' }, adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------
  // Malformed body — 400 VALIDATION_FAILED (itPriority enum shape).
  // -------------------------------------------------------------------
  it('400 VALIDATION_FAILED when itPriority is not one of the enum values', async () => {
    const ticket = await seedTicket();

    const res = await patchItPriority(ticket.id, { itPriority: 'URGENT' }, staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect((res.body.fields as Array<{ field: string }>).map((f) => f.field)).toContain('itPriority');
  });

  it('400 VALIDATION_FAILED when itPriority is an empty string', async () => {
    const ticket = await seedTicket();

    const res = await patchItPriority(ticket.id, { itPriority: '' }, staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('400 VALIDATION_FAILED when itPriority is a number', async () => {
    const ticket = await seedTicket();

    const res = await patchItPriority(ticket.id, { itPriority: 1 }, staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('400 VALIDATION_FAILED when itPriority is missing entirely', async () => {
    const ticket = await seedTicket();

    const res = await patchItPriority(ticket.id, {}, staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('400 MALFORMED_BODY when the top-level body is not a JSON object', async () => {
    const ticket = await seedTicket();

    const res = await patchItPriority(ticket.id, [1, 2, 3], staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MALFORMED_BODY');
  });

  // -------------------------------------------------------------------
  // Content-Type and auth gates.
  // -------------------------------------------------------------------
  it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON content type', async () => {
    const ticket = await seedTicket();

    const res = await request(testServer.server)
      .patch(`/api/tickets/${ticket.id}/it-priority`)
      .set('Cookie', staffCookie)
      .set('Content-Type', 'text/plain')
      .send('itPriority=HIGH');

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('401 UNAUTHENTICATED with no session cookie', async () => {
    const ticket = await seedTicket();

    const res = await patchItPriority(ticket.id, { itPriority: 'HIGH' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('401 UNAUTHENTICATED with an unknown/garbage session cookie', async () => {
    const ticket = await seedTicket();

    const res = await patchItPriority(ticket.id, { itPriority: 'HIGH' }, `${SESSION_COOKIE_NAME}=does-not-exist`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });
});
