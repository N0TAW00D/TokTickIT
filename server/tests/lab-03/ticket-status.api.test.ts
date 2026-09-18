import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';
import type { Priority } from '../../src/validation/ticketFields.js';
import type { TicketStatus } from '../../src/generated/prisma/client.js';

// PATCH /api/tickets/:id/status — docs/lab-03/api-spec.md §5.3
// (specification.md §5.1; FR-23; BR-05, BR-23, BR-24, BR-25; AC-38, AC-39,
// AC-40).
//
// IT-Staff-only, same auth shape as PATCH /:id/owner (an Administrator has a
// read path via GET /api/tickets/:id, so a write attempt is a safe 403, not
// a 404; a Requester has no path here at all, so it's a 404 even on their
// own ticket).
//
// Fixtures reuse the seeded IT Staff/Administrator/Requester accounts
// (server/prisma/seed.ts, LOCAL_DEV_PASSWORD), same convention as
// ticket-owner.api.test.ts/ticket-it-priority.api.test.ts — reset-db.ts
// truncates Ticket/Attachment/TicketCounter/Session (never User) before
// every test, and vitest.config.ts's `fileParallelism: false` runs every
// test file serially, so reusing the seeded Users across tests/files is
// safe.
//
// Tickets are seeded directly via `prisma.ticket.create`, bypassing
// POST /api/tickets and every status-changing route (including this one).

const testServer = useTestServer(app);

let categoryId: number;
let relatedSystemId: number;
let requesterAId: number;
let requesterAEmail: string;
let requesterBEmail: string;
let staffAId: number;
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
  staffAId = staff.id;
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
  status?: TicketStatus;
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
      status: overrides.status ?? 'NEW',
      ownerId: overrides.ownerId ?? null,
    },
  });
}

function patchStatus(ticketId: number | string, body: unknown, cookie?: string) {
  const req = request(testServer.server)
    .patch(`/api/tickets/${ticketId}/status`)
    .set('Content-Type', 'application/json');
  const withCookie = cookie === undefined ? req : req.set('Cookie', cookie);
  return withCookie.send(body as object);
}

describe('PATCH /api/tickets/:id/status (api-spec.md §5.3)', () => {
  // -------------------------------------------------------------------
  // Happy paths — every row of the transition matrix (specification.md
  // §5.1), including several of OPEN's and REOPENED's four options each.
  // A transition into IN_PROGRESS always seeds an owner here; the
  // OWNER_REQUIRED cases below cover the unowned side separately.
  // -------------------------------------------------------------------
  it.each<[TicketStatus, TicketStatus]>([
    ['NEW', 'OPEN'],
    ['NEW', 'IN_PROGRESS'],
    ['NEW', 'CANCELLED'],
    ['OPEN', 'IN_PROGRESS'],
    ['OPEN', 'WAITING_FOR_REQUESTER'],
    ['OPEN', 'RESOLVED'],
    ['OPEN', 'CANCELLED'],
    ['IN_PROGRESS', 'WAITING_FOR_REQUESTER'],
    ['IN_PROGRESS', 'RESOLVED'],
    ['IN_PROGRESS', 'CANCELLED'],
    ['WAITING_FOR_REQUESTER', 'IN_PROGRESS'],
    ['WAITING_FOR_REQUESTER', 'RESOLVED'],
    ['WAITING_FOR_REQUESTER', 'CANCELLED'],
    ['RESOLVED', 'CLOSED'],
    ['RESOLVED', 'REOPENED'],
    ['CLOSED', 'REOPENED'],
    ['REOPENED', 'IN_PROGRESS'],
    ['REOPENED', 'WAITING_FOR_REQUESTER'],
    ['REOPENED', 'RESOLVED'],
    ['REOPENED', 'CANCELLED'],
  ])('%s -> %s succeeds with 200 and the new status', async (from, to) => {
    const ticket = await seedTicket({ status: from, ownerId: staffAId });

    const res = await patchStatus(ticket.id, { status: to }, staffCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticket.id);
    expect(res.body.status).toBe(to);

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.status).toBe(to);
  });

  it('the 200 response carries the full staff ticket-detail shape (same as GET /api/tickets/:id)', async () => {
    const ticket = await seedTicket({
      requestedPriority: 'LOW',
      itPriority: 'HIGH',
      status: 'NEW',
      ownerId: staffAId,
    });

    const res = await patchStatus(ticket.id, { status: 'OPEN' }, staffCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requestedPriority: 'LOW',
      itPriority: 'HIGH',
      status: 'OPEN',
      summary: ticket.summary,
      owner: { id: staffAId, name: expect.any(String) },
    });
    expect(res.body.requester).toEqual({ id: requesterAId, name: expect.any(String), email: expect.any(String) });
    expect(res.body).toHaveProperty('requesterResolvedAt');
    expect(res.body).toHaveProperty('attachments');
  });

  // -------------------------------------------------------------------
  // 409 INVALID_TRANSITION — pair absent from the matrix, including the
  // same-state no-op, and every transition out of the terminal CANCELLED
  // state (BR-23, AC-39).
  // -------------------------------------------------------------------
  it('409 INVALID_TRANSITION for a pair absent from the matrix (NEW -> RESOLVED)', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: 'RESOLVED' }, staffCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_TRANSITION');

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.status).toBe('NEW');
  });

  it('409 INVALID_TRANSITION for a same-state no-op (OPEN -> OPEN), not a silent 200', async () => {
    const ticket = await seedTicket({ status: 'OPEN' });

    const res = await patchStatus(ticket.id, { status: 'OPEN' }, staffCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_TRANSITION');
  });

  it.each<TicketStatus>(['NEW', 'OPEN', 'IN_PROGRESS', 'CANCELLED'])(
    'CANCELLED -> %s is always 409 INVALID_TRANSITION (terminal state)',
    async (to) => {
      const ticket = await seedTicket({ status: 'CANCELLED' });

      const res = await patchStatus(ticket.id, { status: to }, staffCookie);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_TRANSITION');
    },
  );

  // -------------------------------------------------------------------
  // 409 OWNER_REQUIRED — target IN_PROGRESS with no owner, from any
  // otherwise-valid source state (BR-24, AC-40); an owned ticket's
  // identical transition is a 200 (covered by the matrix table above).
  // -------------------------------------------------------------------
  it('409 OWNER_REQUIRED transitioning an unowned ticket NEW -> IN_PROGRESS', async () => {
    const ticket = await seedTicket({ status: 'NEW', ownerId: null });

    const res = await patchStatus(ticket.id, { status: 'IN_PROGRESS' }, staffCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('OWNER_REQUIRED');

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.status).toBe('NEW');
  });

  it('409 OWNER_REQUIRED transitioning an unowned ticket WAITING_FOR_REQUESTER -> IN_PROGRESS', async () => {
    const ticket = await seedTicket({ status: 'WAITING_FOR_REQUESTER', ownerId: null });

    const res = await patchStatus(ticket.id, { status: 'IN_PROGRESS' }, staffCookie);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('OWNER_REQUIRED');
  });

  it('an OWNED ticket transitioning to IN_PROGRESS succeeds with 200 (OWNER_REQUIRED only blocks unowned)', async () => {
    const ticket = await seedTicket({ status: 'OPEN', ownerId: staffAId });

    const res = await patchStatus(ticket.id, { status: 'IN_PROGRESS' }, staffCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  // -------------------------------------------------------------------
  // Authorization — Administrator 403 (has a read path), Requester 404
  // (never a write path here, even on their own ticket).
  // -------------------------------------------------------------------
  it('403 FORBIDDEN for an Administrator (has a read path via GET, but no write here)', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: 'OPEN' }, adminCookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.status).toBe('NEW');
  });

  it('404 NOT_FOUND for a Requester attempting this, even on their own ticket', async () => {
    const ticket = await seedTicket({ requesterId: requesterAId, status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: 'OPEN' }, requesterACookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it("404 NOT_FOUND for a Requester attempting this on someone else's ticket", async () => {
    const ticket = await seedTicket({ requesterId: requesterAId, status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: 'OPEN' }, requesterBCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('unknown ticket id -> 404 NOT_FOUND for IT Staff too', async () => {
    const ticket = await seedTicket();
    const unknownId = ticket.id + 1_000_000;

    const res = await patchStatus(unknownId, { status: 'OPEN' }, staffCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------
  // Malformed body — 400 VALIDATION_FAILED (status enum shape), distinct
  // from a real-but-unreachable status, which is 409 INVALID_TRANSITION.
  // -------------------------------------------------------------------
  it('400 VALIDATION_FAILED when status is not one of the enum values', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: 'FOO' }, staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect((res.body.fields as Array<{ field: string }>).map((f) => f.field)).toContain('status');
  });

  it('400 VALIDATION_FAILED when status is an empty string', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: '' }, staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('400 VALIDATION_FAILED when status is a number', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: 1 }, staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('400 VALIDATION_FAILED when status is missing entirely', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, {}, staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('400 MALFORMED_BODY when the top-level body is not a JSON object', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, [1, 2, 3], staffCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MALFORMED_BODY');
  });

  // -------------------------------------------------------------------
  // Content-Type and auth gates.
  // -------------------------------------------------------------------
  it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON content type', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await request(testServer.server)
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Cookie', staffCookie)
      .set('Content-Type', 'text/plain')
      .send('status=OPEN');

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('401 UNAUTHENTICATED with no session cookie', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: 'OPEN' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('401 UNAUTHENTICATED with an unknown/garbage session cookie', async () => {
    const ticket = await seedTicket({ status: 'NEW' });

    const res = await patchStatus(ticket.id, { status: 'OPEN' }, `${SESSION_COOKIE_NAME}=does-not-exist`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });
});
