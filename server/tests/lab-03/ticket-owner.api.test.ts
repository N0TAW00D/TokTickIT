import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';
import type { Priority } from '../../src/validation/ticketFields.js';

// PATCH /api/tickets/:id/owner — docs/lab-03/api-spec.md §5.1 (FR-21; BR-19,
// BR-20; AC-34, AC-35, AC-36). Claim, assign and reassign are all this one
// operation.
//
// Fixtures reuse the seeded IT Staff/Administrator/Requester accounts
// (server/prisma/seed.ts, LOCAL_DEV_PASSWORD), same convention as
// staff-queue.api.test.ts and ticket-detail-staff.api.test.ts — reset-db.ts
// truncates Ticket/Attachment/TicketCounter/Session (never User) before
// every test, and vitest.config.ts's `fileParallelism: false` runs every
// test file serially, so reusing the seeded Users across tests/files is
// safe. The seed data includes exactly one inactive IT Staff user ("Tom
// Bakker") which the INVALID_OWNER/inactive-user case below looks up by
// role+isActive rather than by name.
//
// Tickets are seeded directly via `prisma.ticket.create`, exactly like
// staff-queue.api.test.ts's own `seedTicket`, bypassing POST /api/tickets
// and this very route.

const testServer = useTestServer(app);

let categoryId: number;
let relatedSystemId: number;
let requesterAId: number;
let requesterAEmail: string;
let requesterBEmail: string;
let staffAId: number;
let staffAEmail: string;
let staffBId: number;
let staffBEmail: string;
let inactiveStaffId: number;
let adminEmail: string;

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const requesters = await prisma.user.findMany({
    where: { isActive: true, role: 'REQUESTER' },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const staffUsers = await prisma.user.findMany({
    where: { isActive: true, role: 'IT_STAFF' },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const inactiveStaff = await prisma.user.findFirstOrThrow({ where: { isActive: false, role: 'IT_STAFF' } });
  const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });

  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
  requesterAId = requesters[0]!.id;
  requesterAEmail = requesters[0]!.email;
  requesterBEmail = requesters[1]!.email;
  staffAId = staffUsers[0]!.id;
  staffAEmail = staffUsers[0]!.email;
  staffBId = staffUsers[1]!.id;
  staffBEmail = staffUsers[1]!.email;
  inactiveStaffId = inactiveStaff.id;
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
let staffACookie: string;
let staffBCookie: string;
let adminCookie: string;
let requesterACookie: string;
let requesterBCookie: string;

beforeEach(async () => {
  staffACookie = await loginAndGetCookie(staffAEmail);
  staffBCookie = await loginAndGetCookie(staffBEmail);
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
  ownerId?: number | null;
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
      ownerId: overrides.ownerId ?? null,
    },
  });
}

function patchOwner(ticketId: number | string, body: unknown, cookie?: string) {
  const req = request(testServer.server)
    .patch(`/api/tickets/${ticketId}/owner`)
    .set('Content-Type', 'application/json');
  const withCookie = cookie === undefined ? req : req.set('Cookie', cookie);
  return withCookie.send(body as object);
}

describe('PATCH /api/tickets/:id/owner (api-spec.md §5.1)', () => {
  // -------------------------------------------------------------------
  // Happy paths — claim, assign, unassign, reassign (AC-34, AC-35).
  // -------------------------------------------------------------------
  it('IT Staff can claim an unassigned ticket by sending its own id, 200 with owner set', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: staffAId }, staffACookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticket.id);
    expect(res.body.owner).toEqual({ id: staffAId, name: expect.any(String) });

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBe(staffAId);
  });

  it('IT Staff can assign to a different active IT Staff user, 200', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: staffBId }, staffACookie);

    expect(res.status).toBe(200);
    expect(res.body.owner).toEqual({ id: staffBId, name: expect.any(String) });
  });

  it('IT Staff can unassign an owned ticket by sending ownerId: null, 200 with owner null', async () => {
    const ticket = await seedTicket({ ownerId: staffAId });

    const res = await patchOwner(ticket.id, { ownerId: null }, staffACookie);

    expect(res.status).toBe(200);
    expect(res.body.owner).toBeNull();

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBeNull();
  });

  it('IT Staff can reassign an already-owned ticket to someone else, 200', async () => {
    const ticket = await seedTicket({ ownerId: staffAId });

    const res = await patchOwner(ticket.id, { ownerId: staffBId }, staffACookie);

    expect(res.status).toBe(200);
    expect(res.body.owner).toEqual({ id: staffBId, name: expect.any(String) });
  });

  it('the 200 response carries the full staff ticket-detail shape (same as GET /api/tickets/:id)', async () => {
    const ticket = await seedTicket({ requestedPriority: 'LOW', itPriority: 'HIGH', ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: staffAId }, staffACookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requestedPriority: 'LOW',
      itPriority: 'HIGH',
      status: 'NEW',
      summary: ticket.summary,
      owner: { id: staffAId, name: expect.any(String) },
    });
    expect(res.body.requester).toEqual({ id: requesterAId, name: expect.any(String), email: expect.any(String) });
    expect(res.body).toHaveProperty('requesterResolvedAt');
    expect(res.body).toHaveProperty('attachments');
  });

  // -------------------------------------------------------------------
  // 409 INVALID_OWNER — inactive user, Requester, nonexistent id all
  // return the identical code/message (BR-20, AC-36).
  // -------------------------------------------------------------------
  it('409 INVALID_OWNER when ownerId names an inactive IT Staff user', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: inactiveStaffId }, staffACookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_OWNER');

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBeNull();
  });

  it('409 INVALID_OWNER when ownerId names a Requester', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: requesterAId }, staffACookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_OWNER');
  });

  it('409 INVALID_OWNER when ownerId names a nonexistent user id', async () => {
    const ticket = await seedTicket({ ownerId: null });
    const bogusId = staffAId + inactiveStaffId + requesterAId + 1_000_000;

    const res = await patchOwner(ticket.id, { ownerId: bogusId }, staffACookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_OWNER');
  });

  it('409 INVALID_OWNER (never 500) when ownerId exceeds the int4 range', async () => {
    // User.id is a Postgres int4 column (max 2_147_483_647); an id past that
    // can't reference any row, so it's a driver-level range error waiting to
    // happen rather than a clean "not found" if it ever reached
    // prisma.user.findUnique. This must be caught before that lookup and
    // treated identically to the nonexistent-id case above (409
    // INVALID_OWNER), never surfaced as a 500 INTERNAL.
    const ticket = await seedTicket({ ownerId: null });
    const outOfRangeId = 2_147_483_648; // PG_INT4_MAX + 1

    const res = await patchOwner(ticket.id, { ownerId: outOfRangeId }, staffACookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_OWNER');

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBeNull();
  });

  it('the three INVALID_OWNER causes return a byte-identical body', async () => {
    const ticket = await seedTicket({ ownerId: null });
    const bogusId = staffAId + inactiveStaffId + requesterAId + 1_000_000;

    const inactiveRes = await patchOwner(ticket.id, { ownerId: inactiveStaffId }, staffACookie);
    const requesterRes = await patchOwner(ticket.id, { ownerId: requesterAId }, staffACookie);
    const nonexistentRes = await patchOwner(ticket.id, { ownerId: bogusId }, staffACookie);

    expect(inactiveRes.body).toEqual(requesterRes.body);
    expect(requesterRes.body).toEqual(nonexistentRes.body);
  });

  // -------------------------------------------------------------------
  // Authorization — Administrator 403 (has a read path), Requester 404
  // (never a write path here, regardless of ownership).
  // -------------------------------------------------------------------
  it('403 FORBIDDEN for an Administrator (has a read path via GET, but no write here)', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: staffAId }, adminCookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBeNull();
  });

  it("404 NOT_FOUND for a Requester attempting this, even on their own ticket", async () => {
    const ticket = await seedTicket({ requesterId: requesterAId, ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: staffAId }, requesterACookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it("404 NOT_FOUND for a Requester attempting this on someone else's ticket", async () => {
    const ticket = await seedTicket({ requesterId: requesterAId, ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: staffAId }, requesterBCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('unknown ticket id -> 404 NOT_FOUND for IT Staff too', async () => {
    const ticket = await seedTicket();
    const unknownId = ticket.id + 1_000_000;

    const res = await patchOwner(unknownId, { ownerId: staffAId }, staffACookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------
  // Malformed body — 400 VALIDATION_FAILED (ownerId shape).
  // -------------------------------------------------------------------
  it('400 VALIDATION_FAILED when ownerId is a string', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: 'staff-a' }, staffACookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect((res.body.fields as Array<{ field: string }>).map((f) => f.field)).toContain('ownerId');
  });

  it('400 VALIDATION_FAILED when ownerId is missing entirely', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, {}, staffACookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('400 VALIDATION_FAILED when ownerId is a non-integer number', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: 1.5 }, staffACookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('400 MALFORMED_BODY when the top-level body is not a JSON object', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, [1, 2, 3], staffACookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MALFORMED_BODY');
  });

  // -------------------------------------------------------------------
  // Content-Type and auth gates.
  // -------------------------------------------------------------------
  it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON content type', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await request(testServer.server)
      .patch(`/api/tickets/${ticket.id}/owner`)
      .set('Cookie', staffACookie)
      .set('Content-Type', 'text/plain')
      .send('ownerId=1');

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('401 UNAUTHENTICATED with no session cookie', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: staffAId });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('401 UNAUTHENTICATED with an unknown/garbage session cookie', async () => {
    const ticket = await seedTicket({ ownerId: null });

    const res = await patchOwner(ticket.id, { ownerId: staffAId }, `${SESSION_COOKIE_NAME}=does-not-exist`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });
});
