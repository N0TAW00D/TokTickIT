import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';
import type { Priority } from '../../src/validation/ticketFields.js';
import type { StaffQueueStatus } from '../../src/validation/staffTicketQueueQuery.js';

// GET /api/staff/tickets — docs/lab-03/api-spec.md §4.1 (FR-19, BR-35,
// AC-26..AC-31, AC-33); docs/lab-03/tests.md API-17..API-23.
//
// Fixtures reuse the seeded IT Staff/Administrator/Requester accounts
// (server/prisma/seed.ts, LOCAL_DEV_PASSWORD) rather than creating
// test-local Users — the same convention my-tickets.api.test.ts uses for
// its Requester fixtures. reset-db.ts truncates Ticket/Attachment/
// TicketCounter/Session (never User) before every test, and
// vitest.config.ts's `fileParallelism: false` runs every test file
// serially, so reusing the seeded Users across tests/files is safe: no
// leftover Ticket rows survive into a test, and no concurrently-running
// file can invalidate this file's Session rows mid-test.
//
// Tickets are seeded directly via `prisma.ticket.create`/`$executeRaw`
// (bypassing POST /api/tickets and PATCH /api/tickets/:id/owner), exactly
// like my-tickets.api.test.ts's own `seedTicket`, so tests can pin exact
// createdAt/updatedAt instants (including ties) and ownerId values that a
// real request-per-ticket flow can't reliably produce.

const testServer = useTestServer(app);

let categoryAId: number;
let categoryBId: number;
let relatedSystemId: number;
let requesterId: number;
let requesterEmail: string;
let adminEmail: string;
let staffAId: number;
let staffAEmail: string;
let staffBId: number;
let staffBName: string;

beforeAll(async () => {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' },
    take: 2,
  });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const requester = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'REQUESTER' } });
  const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });
  const staffUsers = await prisma.user.findMany({
    where: { isActive: true, role: 'IT_STAFF' },
    orderBy: { id: 'asc' },
    take: 2,
  });

  categoryAId = categories[0]!.id;
  categoryBId = categories[1]!.id;
  relatedSystemId = relatedSystem.id;
  requesterId = requester.id;
  requesterEmail = requester.email;
  adminEmail = admin.email;
  staffAId = staffUsers[0]!.id;
  staffAEmail = staffUsers[0]!.email;
  staffBId = staffUsers[1]!.id;
  staffBName = staffUsers[1]!.name;
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

// reset-db.ts truncates Session before every test, so a fresh IT Staff
// cookie must be obtained per test, not once in beforeAll.
let staffCookie: string;

beforeEach(async () => {
  staffCookie = await loginAndGetCookie(staffAEmail);
});

interface SeedTicketOverrides {
  requesterId?: number;
  categoryId?: number;
  relatedSystemId?: number;
  ticketNumber?: string;
  summary?: string;
  description?: string;
  requestedPriority?: Priority;
  itPriority?: Priority;
  status?: StaffQueueStatus;
  ownerId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

let ticketSeq = 0;

async function seedTicket(overrides: SeedTicketOverrides = {}) {
  ticketSeq += 1;
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: overrides.ticketNumber ?? `TKT-2026-${String(ticketSeq).padStart(6, '0')}`,
      requesterId: overrides.requesterId ?? requesterId,
      categoryId: overrides.categoryId ?? categoryAId,
      relatedSystemId: overrides.relatedSystemId ?? relatedSystemId,
      summary: overrides.summary ?? `Seed ticket ${ticketSeq}`,
      description: overrides.description ?? 'x'.repeat(25),
      requestedPriority: overrides.requestedPriority ?? 'MEDIUM',
      itPriority: overrides.itPriority ?? overrides.requestedPriority ?? 'MEDIUM',
      status: overrides.status ?? 'NEW',
      ownerId: overrides.ownerId ?? null,
    },
  });

  // Same change-createdAt/updatedAt-via-raw-SQL trick as
  // my-tickets.api.test.ts's own seedTicket — needed to pin exact instants
  // (including ties) that create()'s own defaulting can't reliably produce.
  if (overrides.createdAt || overrides.updatedAt) {
    const createdAt = overrides.createdAt ?? ticket.createdAt;
    const updatedAt = overrides.updatedAt ?? createdAt;
    await prisma.$executeRaw`UPDATE "Ticket" SET "createdAt" = ${createdAt}, "updatedAt" = ${updatedAt} WHERE id = ${ticket.id}`;
    return prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  }

  return ticket;
}

function listStaffTickets(cookie: string | undefined, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  const req = request(testServer.server).get(`/api/staff/tickets${qs ? `?${qs}` : ''}`);
  return cookie === undefined ? req : req.set('Cookie', cookie);
}

type QueueItem = {
  id: number;
  ticketNumber: string;
  summary: string;
  category: { id: number; name: string };
  requestedPriority: Priority;
  itPriority: Priority;
  status: StaffQueueStatus;
  owner: { id: number; name: string } | null;
  requesterResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function idsOf(items: unknown): number[] {
  return (items as QueueItem[]).map((item) => item.id);
}

describe('GET /api/staff/tickets', () => {
  // -------------------------------------------------------------------
  // Auth — api-spec.md §4.1: "IT Staff only. Requester and Administrator
  // -> 403 FORBIDDEN before any lookup (§1.4)." Unlike some other Lab 3
  // endpoints (e.g. IT Priority, api-spec.md §5's owner PATCH), this route
  // mounts requireRole('IT_STAFF') alone (src/routes/staff.ts) — an
  // Administrator gets the same before-any-lookup 403 a Requester does,
  // never a 200.
  // -------------------------------------------------------------------
  describe('auth', () => {
    it('401 UNAUTHENTICATED with no session cookie', async () => {
      const res = await listStaffTickets(undefined);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('401 UNAUTHENTICATED with an unknown/garbage session cookie', async () => {
      const res = await listStaffTickets(`${SESSION_COOKIE_NAME}=does-not-exist`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('403 FORBIDDEN for a Requester, before any lookup', async () => {
      await seedTicket();
      const cookie = await loginAndGetCookie(requesterEmail);

      const res = await listStaffTickets(cookie);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body).not.toHaveProperty('items');
    });

    it('403 FORBIDDEN for an Administrator too — this queue is IT-Staff-exclusive, not "IT Staff or Administrator"', async () => {
      await seedTicket();
      const cookie = await loginAndGetCookie(adminEmail);

      const res = await listStaffTickets(cookie);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body).not.toHaveProperty('items');
    });

    it('200 for IT Staff with no query params', async () => {
      await seedTicket();

      const res = await listStaffTickets(staffCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // API-17 (AC-26): default ordering spans all Requesters, IT Priority
  // desc (by severity, not alphabetically) then createdAt asc tie-break.
  // -------------------------------------------------------------------
  it('API-17: default ordering is itPriority desc by severity (not alphabetically), then createdAt asc; spans every Requester', async () => {
    const otherRequester = await prisma.user.findFirstOrThrow({
      where: { isActive: true, role: 'REQUESTER', id: { not: requesterId } },
    });

    // Alphabetically, HIGH < LOW < MEDIUM, so a naive string ORDER BY DESC
    // would yield [medium, low, high2, high1] — the opposite grouping of
    // what severity order requires. Two HIGH tickets with distinct
    // createdAt prove the secondary ascending tie-break is real, not
    // incidental to insertion order.
    const low = await seedTicket({ itPriority: 'LOW', createdAt: new Date('2026-01-01T00:00:00.000Z') });
    const medium = await seedTicket({
      requesterId: otherRequester.id,
      itPriority: 'MEDIUM',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const highLater = await seedTicket({ itPriority: 'HIGH', createdAt: new Date('2026-01-04T00:00:00.000Z') });
    const highEarlier = await seedTicket({ itPriority: 'HIGH', createdAt: new Date('2026-01-03T00:00:00.000Z') });

    const res = await listStaffTickets(staffCookie);

    expect(res.status).toBe(200);
    expect(idsOf(res.body.items)).toEqual([highEarlier.id, highLater.id, medium.id, low.id]);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
  });

  it('the 200 response item carries the full documented shape, with owner: null for an unassigned ticket', async () => {
    const ticket = await seedTicket({
      categoryId: categoryAId,
      requestedPriority: 'MEDIUM',
      itPriority: 'HIGH',
      status: 'OPEN',
    });

    const res = await listStaffTickets(staffCookie);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0] as QueueItem;
    expect(item).toEqual({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      summary: ticket.summary,
      category: { id: categoryAId, name: expect.any(String) },
      requestedPriority: 'MEDIUM',
      itPriority: 'HIGH',
      status: 'OPEN',
      owner: null,
      requesterResolvedAt: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  // -------------------------------------------------------------------
  // API-18 (AC-27): search matches ticket number OR summary,
  // case-insensitively, and nothing else.
  // -------------------------------------------------------------------
  it('API-18: search matches ticket number and summary, case-insensitively, and nothing else', async () => {
    const byNumber = await seedTicket({ ticketNumber: 'TKT-2026-000777', summary: 'Something unrelated' });
    const bySummary = await seedTicket({ ticketNumber: 'TKT-2026-000001', summary: 'Cannot connect to VPN' });
    const neither = await seedTicket({ ticketNumber: 'TKT-2026-000002', summary: 'Printer jam' });

    const byNumberRes = await listStaffTickets(staffCookie, { search: '000777' });
    expect(idsOf(byNumberRes.body.items)).toEqual([byNumber.id]);

    // Lowercase against a summary containing "VPN" — proves case-insensitivity.
    const bySummaryRes = await listStaffTickets(staffCookie, { search: 'vpn' });
    expect(idsOf(bySummaryRes.body.items)).toEqual([bySummary.id]);

    const noMatchRes = await listStaffTickets(staffCookie, { search: 'zzz-not-present-anywhere' });
    expect(noMatchRes.status).toBe(200);
    expect(noMatchRes.body.items).toEqual([]);
    expect(noMatchRes.body.totalItems).toBe(0);

    expect(idsOf((await listStaffTickets(staffCookie)).body.items)).toContain(neither.id);
  });

  // -------------------------------------------------------------------
  // API-19 (AC-28): each filter independently — status, itPriority,
  // categoryId, owner=unassigned, owner=me, owner=<id>.
  // -------------------------------------------------------------------
  describe('API-19: filters', () => {
    it('status filters to exactly the matching set', async () => {
      const open = await seedTicket({ status: 'OPEN' });
      const inProgress = await seedTicket({ status: 'IN_PROGRESS' });

      const res = await listStaffTickets(staffCookie, { status: 'OPEN' });

      expect(idsOf(res.body.items)).toEqual([open.id]);
      expect(idsOf(res.body.items)).not.toContain(inProgress.id);
    });

    it('itPriority filters to exactly the matching set', async () => {
      const high = await seedTicket({ itPriority: 'HIGH' });
      const low = await seedTicket({ itPriority: 'LOW' });

      const res = await listStaffTickets(staffCookie, { itPriority: 'HIGH' });

      expect(idsOf(res.body.items)).toEqual([high.id]);
      expect(idsOf(res.body.items)).not.toContain(low.id);
    });

    it('categoryId filters to exactly the matching set', async () => {
      const inA = await seedTicket({ categoryId: categoryAId });
      const inB = await seedTicket({ categoryId: categoryBId });

      const res = await listStaffTickets(staffCookie, { categoryId: String(categoryAId) });

      expect(idsOf(res.body.items)).toEqual([inA.id]);
      expect(idsOf(res.body.items)).not.toContain(inB.id);
    });

    it('owner=unassigned returns only tickets with no owner', async () => {
      const unassigned = await seedTicket({ ownerId: null });
      const assigned = await seedTicket({ ownerId: staffAId });

      const res = await listStaffTickets(staffCookie, { owner: 'unassigned' });

      expect(idsOf(res.body.items)).toEqual([unassigned.id]);
      expect(idsOf(res.body.items)).not.toContain(assigned.id);
      const item = (res.body.items as QueueItem[]).find((i) => i.id === unassigned.id)!;
      expect(item.owner).toBeNull();
    });

    it('owner=me resolves to the caller\'s own id — staff A sees only A-owned tickets, not B\'s', async () => {
      const ownedByA = await seedTicket({ ownerId: staffAId });
      const ownedByB = await seedTicket({ ownerId: staffBId });
      const unassigned = await seedTicket({ ownerId: null });

      const res = await listStaffTickets(staffCookie, { owner: 'me' });

      expect(idsOf(res.body.items)).toEqual([ownedByA.id]);
      expect(idsOf(res.body.items)).not.toContain(ownedByB.id);
      expect(idsOf(res.body.items)).not.toContain(unassigned.id);
    });

    it('owner=<id> filters to tickets owned by that specific user, regardless of who is calling', async () => {
      const ownedByA = await seedTicket({ ownerId: staffAId });
      const ownedByB = await seedTicket({ ownerId: staffBId });

      // Staff A queries for B's tickets specifically — proves owner=<id> is
      // not silently aliased to "me".
      const res = await listStaffTickets(staffCookie, { owner: String(staffBId) });

      expect(idsOf(res.body.items)).toEqual([ownedByB.id]);
      expect(idsOf(res.body.items)).not.toContain(ownedByA.id);
      const item = (res.body.items as QueueItem[]).find((i) => i.id === ownedByB.id)!;
      expect(item.owner).toEqual({ id: staffBId, name: staffBName });
    });
  });

  // -------------------------------------------------------------------
  // API-20 (AC-29): each sort field, both directions.
  // -------------------------------------------------------------------
  describe('API-20: sorting', () => {
    it('sort=createdAt asc/desc orders by createdAt', async () => {
      const oldest = await seedTicket({ createdAt: new Date('2026-02-01T00:00:00.000Z') });
      const middle = await seedTicket({ createdAt: new Date('2026-02-02T00:00:00.000Z') });
      const newest = await seedTicket({ createdAt: new Date('2026-02-03T00:00:00.000Z') });

      const asc = await listStaffTickets(staffCookie, { sort: 'createdAt', direction: 'asc' });
      expect(idsOf(asc.body.items)).toEqual([oldest.id, middle.id, newest.id]);

      const desc = await listStaffTickets(staffCookie, { sort: 'createdAt', direction: 'desc' });
      expect(idsOf(desc.body.items)).toEqual([newest.id, middle.id, oldest.id]);
    });

    it('sort=updatedAt asc/desc orders by updatedAt', async () => {
      const oldest = await seedTicket({
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      });
      const middle = await seedTicket({
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-02T00:00:00.000Z'),
      });
      const newest = await seedTicket({
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-03T00:00:00.000Z'),
      });

      const asc = await listStaffTickets(staffCookie, { sort: 'updatedAt', direction: 'asc' });
      expect(idsOf(asc.body.items)).toEqual([oldest.id, middle.id, newest.id]);

      const desc = await listStaffTickets(staffCookie, { sort: 'updatedAt', direction: 'desc' });
      expect(idsOf(desc.body.items)).toEqual([newest.id, middle.id, oldest.id]);
    });

    it('sort=itPriority asc/desc orders by severity, not alphabetically', async () => {
      const high = await seedTicket({ itPriority: 'HIGH', createdAt: new Date('2026-04-01T00:00:00.000Z') });
      const medium = await seedTicket({ itPriority: 'MEDIUM', createdAt: new Date('2026-04-02T00:00:00.000Z') });
      const low = await seedTicket({ itPriority: 'LOW', createdAt: new Date('2026-04-03T00:00:00.000Z') });

      const asc = await listStaffTickets(staffCookie, { sort: 'itPriority', direction: 'asc' });
      expect(idsOf(asc.body.items)).toEqual([low.id, medium.id, high.id]);

      const desc = await listStaffTickets(staffCookie, { sort: 'itPriority', direction: 'desc' });
      expect(idsOf(desc.body.items)).toEqual([high.id, medium.id, low.id]);
    });

    it('sort=ticketNumber asc/desc orders lexicographically', async () => {
      const first = await seedTicket({ ticketNumber: 'TKT-2026-000010' });
      const second = await seedTicket({ ticketNumber: 'TKT-2026-000020' });
      const third = await seedTicket({ ticketNumber: 'TKT-2026-000030' });

      const asc = await listStaffTickets(staffCookie, { sort: 'ticketNumber', direction: 'asc' });
      expect(idsOf(asc.body.items)).toEqual([first.id, second.id, third.id]);

      const desc = await listStaffTickets(staffCookie, { sort: 'ticketNumber', direction: 'desc' });
      expect(idsOf(desc.body.items)).toEqual([third.id, second.id, first.id]);
    });
  });

  // -------------------------------------------------------------------
  // API-21 (AC-30): pagination — page/pageSize behavior and metadata
  // shape (page, pageSize, totalItems, totalPages).
  // -------------------------------------------------------------------
  it('API-21: pagination slices correctly and reports exact metadata', async () => {
    const numbers = Array.from({ length: 5 }, (_, i) => `TKT-2026-09000${i}`);
    const tickets = [];
    for (const ticketNumber of numbers) {
      tickets.push(await seedTicket({ ticketNumber }));
    }

    const page1 = await listStaffTickets(staffCookie, {
      sort: 'ticketNumber',
      direction: 'asc',
      page: '1',
      pageSize: '2',
    });
    const page2 = await listStaffTickets(staffCookie, {
      sort: 'ticketNumber',
      direction: 'asc',
      page: '2',
      pageSize: '2',
    });
    const page3 = await listStaffTickets(staffCookie, {
      sort: 'ticketNumber',
      direction: 'asc',
      page: '3',
      pageSize: '2',
    });

    expect(idsOf(page1.body.items)).toEqual([tickets[0]!.id, tickets[1]!.id]);
    expect(idsOf(page2.body.items)).toEqual([tickets[2]!.id, tickets[3]!.id]);
    expect(idsOf(page3.body.items)).toEqual([tickets[4]!.id]);

    for (const [res, page] of [
      [page1, 1],
      [page2, 2],
      [page3, 3],
    ] as const) {
      expect(res.body.page).toBe(page);
      expect(res.body.pageSize).toBe(2);
      expect(res.body.totalItems).toBe(5);
      expect(res.body.totalPages).toBe(3);
      expect(Object.keys(res.body).sort()).toEqual(['items', 'page', 'pageSize', 'totalItems', 'totalPages'].sort());
    }
  });

  it('a page past the last page returns 200 with items: [] and correct metadata (not an error)', async () => {
    await seedTicket();
    await seedTicket();

    const res = await listStaffTickets(staffCookie, { page: '99', pageSize: '10' });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body).toMatchObject({ page: 99, pageSize: 10, totalItems: 2, totalPages: 1 });
  });

  // -------------------------------------------------------------------
  // API-22 (AC-31): every documented 400 INVALID_QUERY case, never a 500,
  // always a `fields` array.
  // -------------------------------------------------------------------
  it('API-22: every documented invalid query case returns 400 INVALID_QUERY with a fields array, never 500', async () => {
    const cases: Array<[label: string, query: Record<string, string>, expectedField: string]> = [
      ['sort=bogus (unknown sort field)', { sort: 'bogus' }, 'sort'],
      ['direction=sideways (not asc/desc)', { direction: 'sideways' }, 'direction'],
      ['pageSize=0 (below 1)', { pageSize: '0' }, 'pageSize'],
      ['pageSize=101 (above 100)', { pageSize: '101' }, 'pageSize'],
      ['page=0 (below 1)', { page: '0' }, 'page'],
      ['page=-1 (below 1)', { page: '-1' }, 'page'],
      ['categoryId=abc (non-integer)', { categoryId: 'abc' }, 'categoryId'],
      ['status=BOGUS (not in the enum)', { status: 'BOGUS' }, 'status'],
      ['itPriority=URGENT (not in the enum)', { itPriority: 'URGENT' }, 'itPriority'],
      ['owner=bogus (neither unassigned/me nor an integer)', { owner: 'bogus' }, 'owner'],
    ];

    for (const [label, query, expectedField] of cases) {
      const res = await listStaffTickets(staffCookie, query);
      expect(res.status, label).toBe(400);
      expect(res.body.error, label).toBe('INVALID_QUERY');
      expect(Array.isArray(res.body.fields), label).toBe(true);
      const fields = (res.body.fields as Array<{ field: string; message: string }>).map((f) => f.field);
      expect(fields, label).toContain(expectedField);
      for (const fieldError of res.body.fields as Array<Record<string, unknown>>) {
        expect(typeof fieldError.field, label).toBe('string');
        expect(typeof fieldError.message, label).toBe('string');
      }
    }
  });

  it('multiple invalid params in one request are all reported, not just the first', async () => {
    const res = await listStaffTickets(staffCookie, { sort: 'bogus', page: '0', owner: 'bogus' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_QUERY');
    const fields = (res.body.fields as Array<{ field: string; message: string }>).map((f) => f.field);
    expect(fields.sort()).toEqual(['owner', 'page', 'sort'].sort());
  });

  // -------------------------------------------------------------------
  // API-23 (AC-33): empty queue and a non-matching filter both 200 with
  // items: [] and correct totals — a no-results state, not an error.
  // -------------------------------------------------------------------
  it('API-23: an empty queue returns 200 with items: [] and totalItems: 0', async () => {
    const res = await listStaffTickets(staffCookie);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalItems).toBe(0);
    expect(res.body.totalPages).toBe(0);
  });

  it('API-23: a filter combination that matches nothing returns 200 with items: [], not an error', async () => {
    await seedTicket({ status: 'NEW', itPriority: 'LOW', categoryId: categoryAId });

    const res = await listStaffTickets(staffCookie, {
      status: 'NEW',
      itPriority: 'HIGH',
      categoryId: String(categoryAId),
    });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalItems).toBe(0);
  });
});
