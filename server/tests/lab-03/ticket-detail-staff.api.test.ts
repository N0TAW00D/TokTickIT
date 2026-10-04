import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';
import type { Priority } from '../../src/validation/ticketFields.js';

// GET /api/tickets/:id — docs/lab-03/api-spec.md §5 (FR-20, AC-67): this
// issue (#72) extends the Lab 2 route (docs/lab-02/api-spec.md §3.3,
// covered unchanged by tests/lab-02/ticket-detail.api.test.ts) so IT Staff
// and Administrators can fetch ANY ticket and additionally see
// `itPriority`, while a Requester keeps the exact Lab 2 own-ticket-only/404
// behavior. This file covers only the staff-facing half plus a quick
// Requester regression check — the full Requester-path test matrix stays in
// the untouched Lab 2 file.
//
// Fixtures reuse the seeded IT Staff/Administrator/Requester accounts
// (server/prisma/seed.ts, LOCAL_DEV_PASSWORD), same convention as
// staff-queue.api.test.ts — reset-db.ts truncates Ticket/Attachment/
// TicketCounter/Session (never User) before every test, and
// vitest.config.ts's `fileParallelism: false` runs every test file
// serially, so reusing the seeded Users across tests/files is safe.
//
// Tickets are seeded directly via `prisma.ticket.create`, exactly like
// staff-queue.api.test.ts's own `seedTicket`, bypassing POST /api/tickets
// and PATCH /api/tickets/:id/owner.

const testServer = useTestServer(app);

let categoryId: number;
let relatedSystemId: number;
let requesterAId: number;
let requesterAEmail: string;
let requesterBId: number;
let requesterBEmail: string;
let staffAId: number;
let staffAEmail: string;
let staffBId: number;
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
  const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });

  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
  requesterAId = requesters[0]!.id;
  requesterAEmail = requesters[0]!.email;
  requesterBId = requesters[1]!.id;
  requesterBEmail = requesters[1]!.email;
  staffAId = staffUsers[0]!.id;
  staffAEmail = staffUsers[0]!.email;
  staffBId = staffUsers[1]!.id;
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
let adminCookie: string;
let requesterACookie: string;
let requesterBCookie: string;

beforeEach(async () => {
  staffACookie = await loginAndGetCookie(staffAEmail);
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

function getTicket(ticketId: number | string, cookie?: string) {
  const req = request(testServer.server).get(`/api/tickets/${ticketId}`);
  return cookie === undefined ? req : req.set('Cookie', cookie);
}

describe('GET /api/tickets/:id — IT Staff/Administrator access (api-spec.md §5)', () => {
  it('IT Staff can GET a ticket it owns, 200 with itPriority present', async () => {
    const ticket = await seedTicket({ ownerId: staffAId, itPriority: 'HIGH' });

    const res = await getTicket(ticket.id, staffACookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticket.id);
    expect(res.body.itPriority).toBe('HIGH');
    expect(res.body.owner).toEqual({ id: staffAId, name: expect.any(String) });
  });

  it('IT Staff can GET a ticket it does NOT own (any ticket, per FR-20), 200 with itPriority present', async () => {
    const ticket = await seedTicket({ ownerId: staffBId, itPriority: 'LOW' });

    const res = await getTicket(ticket.id, staffACookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticket.id);
    expect(res.body.itPriority).toBe('LOW');
    expect(res.body.owner).toEqual({ id: staffBId, name: expect.any(String) });
  });

  it('Administrator can GET any ticket, 200 with itPriority present', async () => {
    const ticket = await seedTicket({ ownerId: staffAId, itPriority: 'MEDIUM' });

    const res = await getTicket(ticket.id, adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticket.id);
    expect(res.body.itPriority).toBe('MEDIUM');
  });

  it('the full staff response shape carries requestedPriority, itPriority, owner and requesterResolvedAt together', async () => {
    const ticket = await seedTicket({ requestedPriority: 'LOW', itPriority: 'HIGH', ownerId: staffAId });

    const res = await getTicket(ticket.id, staffACookie);

    expect(res.status).toBe(200);
    expect(res.body.requestedPriority).toBe('LOW');
    expect(res.body.itPriority).toBe('HIGH');
    expect(res.body.owner).toEqual({ id: staffAId, name: expect.any(String) });
    expect(res.body.requesterResolvedAt).toBeNull();
  });

  // AC-44 integrated: the siloed checks elsewhere (this file's own "starts
  // null" test above, and comments-notes.api.test.ts's Requester-side
  // reload check) each only prove one role's read in isolation. This test
  // drives the real cross-role sequence in one place — a Requester reports
  // a ticket appears resolved, then IT Staff fetches that SAME ticket — so
  // it would fail if the two sides were ever wired to different data.
  it('AC-44: after a Requester reports a ticket appears resolved, IT Staff fetching the same ticket sees requesterResolvedAt populated', async () => {
    const ticket = await seedTicket({ requesterId: requesterAId, ownerId: staffAId });

    const beforeRes = await getTicket(ticket.id, staffACookie);
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.requesterResolvedAt).toBeNull();

    const resolveRes = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/requester-resolved`)
      .set('Cookie', requesterACookie)
      .set('Content-Type', 'application/json')
      .send();
    expect(resolveRes.status).toBe(204);

    const afterRes = await getTicket(ticket.id, staffACookie);
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.requesterResolvedAt).toEqual(expect.any(String));
    expect(new Date(afterRes.body.requesterResolvedAt as string).getTime()).not.toBeNaN();
  });

  it('unknown ticket id -> 404 NOT_FOUND for IT Staff', async () => {
    const ticket = await seedTicket();
    const unknownId = ticket.id + 1_000_000;

    const res = await getTicket(unknownId, staffACookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('unknown ticket id -> 404 NOT_FOUND for Administrator', async () => {
    const ticket = await seedTicket();
    const unknownId = ticket.id + 1_000_000;

    const res = await getTicket(unknownId, adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('401 UNAUTHENTICATED with no session cookie', async () => {
    const ticket = await seedTicket();

    const res = await getTicket(ticket.id);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('401 UNAUTHENTICATED with an unknown/garbage session cookie', async () => {
    const ticket = await seedTicket();

    const res = await getTicket(ticket.id, `${SESSION_COOKIE_NAME}=does-not-exist`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });
});

describe('GET /api/tickets/:id — Requester regression check (Lab 2 behavior unchanged)', () => {
  it("Requester's own ticket is still 200, and the body carries no itPriority key at all", async () => {
    const ticket = await seedTicket({ requesterId: requesterAId, itPriority: 'HIGH' });

    const res = await getTicket(ticket.id, requesterACookie);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('itPriority');
    expect(res.body.owner).toBeNull();
  });

  it("Requester still gets 404 on another Requester's ticket", async () => {
    const bTicket = await seedTicket({ requesterId: requesterBId });

    const res = await getTicket(bTicket.id, requesterACookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});
