import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import {
  NOW, WINDOW_START, NOT_OPEN, UPDATED_RECENTLY, ALL_STATUSES,
  freezeClock, unfreezeClock, hoursBefore, userByName, loginAs, makeTicket, addAction,
  sqlCount, get,
} from './dashboardFixtures.js';

// GET /api/dashboard/staff — docs/lab-04/api-spec.md §5 and the drill-down
// parameters of §6.2 (BR-20..BR-32). API-23..API-29, API-31. The clock is
// frozen at NOW and every expected value is recomputed with independent SQL.

const testServer = useTestServer(app);

type U = { id: number; email: string };
let priya: U;
let carlos: U;
let emma: U;
let olivia: U;
let jennifer: U;
let priyaCookie: string;
let adminCookie: string;
let emmaCookie: string;

const DAY = 24;

beforeEach(async () => {
  freezeClock();
  priya = await userByName('Priya Natarajan');
  carlos = await userByName('Carlos Mendes');
  emma = await userByName('Emma Fischer');
  olivia = await userByName('Olivia Grant');
  jennifer = await userByName('Jennifer Anderson');
  priyaCookie = await loginAs(testServer.server, priya.email);
  adminCookie = await loginAs(testServer.server, olivia.email);
  emmaCookie = await loginAs(testServer.server, emma.email);
});

afterEach(() => unfreezeClock());

async function seedQueue() {
  const mk = (o: Omit<Parameters<typeof makeTicket>[0], 'requesterId'>) => makeTicket({ requesterId: jennifer.id, ...o });
  const A = await mk({ status: 'OPEN', itPriority: 'HIGH', ownerId: null, updatedAt: hoursBefore(NOW, 1) });
  const B = await mk({ status: 'IN_PROGRESS', itPriority: 'HIGH', ownerId: priya.id, updatedAt: hoursBefore(NOW, 2 * DAY) });
  const C = await mk({ status: 'IN_PROGRESS', itPriority: 'MEDIUM', ownerId: carlos.id, updatedAt: hoursBefore(NOW, 10 * DAY) });
  const D = await mk({ status: 'NEW', itPriority: 'LOW', ownerId: null, updatedAt: hoursBefore(NOW, 1) });
  const E = await mk({ status: 'WAITING_FOR_REQUESTER', itPriority: 'MEDIUM', ownerId: priya.id, updatedAt: hoursBefore(NOW, 20 * DAY) });
  const F = await mk({ status: 'RESOLVED', itPriority: 'HIGH', ownerId: priya.id, updatedAt: hoursBefore(NOW, 1) });
  const G = await mk({ status: 'CLOSED', itPriority: 'HIGH', ownerId: null, updatedAt: hoursBefore(NOW, 30 * DAY) });
  const H = await mk({ status: 'CANCELLED', itPriority: 'LOW', ownerId: null, updatedAt: hoursBefore(NOW, 30 * DAY) });
  const I = await mk({ status: 'REOPENED', itPriority: 'LOW', ownerId: carlos.id, updatedAt: hoursBefore(NOW, 12 * DAY) });

  // Priya's open Actions (BR-25): a2 is earlier than a1 to prove actionAt asc.
  const a1 = await addAction({ ticketId: B.id, performedById: carlos.id, assigneeId: priya.id, status: 'PLANNED', actionAt: hoursBefore(NOW, 3), followUpRequired: true });
  const a2 = await addAction({ ticketId: B.id, performedById: priya.id, assigneeId: null, status: 'IN_PROGRESS', actionAt: hoursBefore(NOW, 6) });
  const a3 = await addAction({ ticketId: C.id, performedById: priya.id, assigneeId: null, status: 'PLANNED', actionAt: hoursBefore(NOW, 4) });
  // Not hers / not open / wrong status:
  await addAction({ ticketId: C.id, performedById: carlos.id, assigneeId: priya.id, status: 'COMPLETED', followUpRequired: true });
  await addAction({ ticketId: E.id, performedById: priya.id, assigneeId: carlos.id, status: 'PLANNED', followUpRequired: true });
  await addAction({ ticketId: F.id, performedById: priya.id, assigneeId: priya.id, status: 'PLANNED', followUpRequired: true });
  await addAction({ ticketId: A.id, performedById: priya.id, assigneeId: priya.id, status: 'CANCELLED', followUpRequired: true });
  await addAction({ ticketId: G.id, performedById: priya.id, assigneeId: priya.id, status: 'IN_PROGRESS', followUpRequired: true });
  return { A, B, C, D, E, F, G, H, I, a1, a2, a3 };
}

const MY_ACTION_PRED = `a.status IN ('PLANNED','IN_PROGRESS') AND t.status NOT IN ${NOT_OPEN}
  AND (a."assigneeId" = $1 OR (a."assigneeId" IS NULL AND a."performedById" = $1))`;

async function dash(cookie: string) {
  return get(testServer.server, '/api/dashboard/staff', cookie);
}

describe('GET /api/dashboard/staff', () => {
  it('API-23: unassigned, ownedByMe, byStatus (eight keys) and byItPriority (open only, three keys) equal independent SQL', async () => {
    await seedQueue();
    const res = await dash(priyaCookie);
    expect(res.status).toBe(200);

    expect(res.body.generatedAt).toBe(NOW.toISOString());
    expect(res.body.timeZone).toBe('Asia/Bangkok');
    expect(res.body.windowStart).toBe(WINDOW_START.toISOString());

    const unassigned = await sqlCount(`SELECT count(*) AS v FROM "Ticket" WHERE status NOT IN ${NOT_OPEN} AND "ownerId" IS NULL`);
    const owned = await sqlCount(`SELECT count(*) AS v FROM "Ticket" WHERE status NOT IN ${NOT_OPEN} AND "ownerId" = $1`, priya.id);
    expect(unassigned).toBe(2); // A, D
    expect(owned).toBe(2); // B, E
    expect(res.body.metrics.unassigned).toBe(unassigned);
    expect(res.body.metrics.ownedByMe).toBe(owned);

    expect(Object.keys(res.body.byStatus).sort()).toEqual([...ALL_STATUSES].sort());
    for (const s of ALL_STATUSES) {
      const n = await sqlCount(`SELECT count(*) AS v FROM "Ticket" WHERE status = $1::"TicketStatus"`, s);
      expect(res.body.byStatus[s], `byStatus.${s}`).toBe(n);
    }
    expect(res.body.byStatus.IN_PROGRESS).toBe(2);

    expect(Object.keys(res.body.byItPriority).sort()).toEqual(['HIGH', 'LOW', 'MEDIUM']);
    for (const p of ['LOW', 'MEDIUM', 'HIGH']) {
      const n = await sqlCount(`SELECT count(*) AS v FROM "Ticket" WHERE status NOT IN ${NOT_OPEN} AND "itPriority" = $1::"Priority"`, p);
      expect(res.body.byItPriority[p], `byItPriority.${p}`).toBe(n);
    }
    // Closed HIGH tickets (F, G) are not counted: open HIGH = A, B.
    expect(res.body.byItPriority.HIGH).toBe(2);
  });

  it('API-24: My Open Actions follows BR-25; actions vs distinct tickets; items ordered actionAt asc', async () => {
    const q = await seedQueue();
    const res = await dash(priyaCookie);

    const actions = await sqlCount(
      `SELECT count(*) AS v FROM "ActionTaken" a JOIN "Ticket" t ON t.id = a."ticketId" WHERE ${MY_ACTION_PRED}`, priya.id);
    const tickets = await sqlCount(
      `SELECT count(DISTINCT a."ticketId") AS v FROM "ActionTaken" a JOIN "Ticket" t ON t.id = a."ticketId" WHERE ${MY_ACTION_PRED}`, priya.id);
    expect(actions).toBe(3);
    expect(tickets).toBe(2);

    expect(res.body.myOpenActions.actions).toBe(actions);
    expect(res.body.myOpenActions.tickets).toBe(tickets);
    const items = res.body.myOpenActions.items;
    expect(items.map((i: { id: number }) => i.id)).toEqual([q.a2.id, q.a3.id, q.a1.id]);
    expect(items[0]).toMatchObject({
      id: q.a2.id, ticketId: q.B.id, ticketNumber: q.B.ticketNumber,
      description: 'Fixture action', status: 'IN_PROGRESS', followUpRequired: false,
      actionAt: hoursBefore(NOW, 6).toISOString(),
    });
    expect(Object.keys(items[0]).sort()).toEqual(
      ['actionAt', 'description', 'followUpRequired', 'id', 'status', 'ticketId', 'ticketNumber']);
  });

  it('API-25: Follow-ups count distinct open Tickets and skip CANCELLED Actions; Urgent is open + HIGH only; Recently Updated spans all statuses', async () => {
    const q = await seedQueue();
    const res = await dash(priyaCookie);

    const followUps = await sqlCount(
      `SELECT count(DISTINCT a."ticketId") AS v FROM "ActionTaken" a JOIN "Ticket" t ON t.id = a."ticketId"
        WHERE a."followUpRequired" AND a.status <> 'CANCELLED' AND t.status NOT IN ${NOT_OPEN}`);
    expect(followUps).toBe(3); // B (a1), C (a COMPLETED action still counts) and E
    expect(res.body.metrics.followUpsRequired).toBe(followUps);

    const urgent = await sqlCount(`SELECT count(*) AS v FROM "Ticket" WHERE status NOT IN ${NOT_OPEN} AND "itPriority" = 'HIGH'`);
    expect(urgent).toBe(2);
    expect(res.body.metrics.urgent).toBe(urgent);
    expect(res.body.urgentTickets.total).toBe(urgent);
    expect(res.body.urgentTickets.items.map((i: { id: number }) => i.id)).toEqual([q.A.id, q.B.id]); // updatedAt desc
    expect(res.body.urgentTickets.items[1]).toMatchObject({
      id: q.B.id, ticketNumber: q.B.ticketNumber, status: 'IN_PROGRESS', itPriority: 'HIGH',
      owner: { id: priya.id, name: 'Priya Natarajan' }, updatedAt: hoursBefore(NOW, 2 * DAY).toISOString(),
    });
    expect(res.body.urgentTickets.items[0].owner).toBeNull();

    const recent = await sqlCount(`SELECT count(*) AS v FROM "Ticket" WHERE ${UPDATED_RECENTLY}`, NOW.toISOString());
    expect(recent).toBe(4); // A, B, D and the RESOLVED F
    expect(res.body.recentlyUpdated.total).toBe(recent);
    const ids = res.body.recentlyUpdated.items.map((i: { id: number }) => i.id);
    expect(ids).toContain(q.F.id); // a RESOLVED ticket is included
    expect(ids).not.toContain(q.C.id); // updated 10 days ago
  });

  it('API-26: Administrator gets userCounts with three roles; IT Staff has no such key', async () => {
    await seedQueue();
    const res = await dash(adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.userCounts.map((r: { role: string }) => r.role)).toEqual(['REQUESTER', 'IT_STAFF', 'ADMINISTRATOR']);
    for (const row of res.body.userCounts) {
      const active = await sqlCount(`SELECT count(*) AS v FROM "User" WHERE role = $1::"Role" AND "isActive"`, row.role);
      const inactive = await sqlCount(`SELECT count(*) AS v FROM "User" WHERE role = $1::"Role" AND NOT "isActive"`, row.role);
      expect(row, row.role).toEqual({ role: row.role, active, inactive });
    }
    // Seed has inactive users in two roles, so the check is not vacuous.
    expect(res.body.userCounts.find((r: { role: string }) => r.role === 'REQUESTER').inactive).toBeGreaterThan(0);

    const staff = await dash(priyaCookie);
    expect(staff.status).toBe(200);
    expect(staff.body).not.toHaveProperty('userCounts');
  });

  it('API-27: Emma Fischer (no owned Tickets, no Actions) gets zeros, empty My Open Actions and full zero-valued key maps', async () => {
    await seedQueue();
    const res = await dash(emmaCookie);
    expect(res.status).toBe(200);
    expect(res.body.metrics.ownedByMe).toBe(0);
    expect(res.body.myOpenActions).toEqual({ actions: 0, tickets: 0, items: [] });

    // Empty database: every key is still present, all zero.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Ticket" RESTART IDENTITY CASCADE;');
    const empty = await dash(emmaCookie);
    expect(empty.status).toBe(200);
    expect(empty.body.metrics).toEqual({ unassigned: 0, ownedByMe: 0, urgent: 0, followUpsRequired: 0 });
    expect(empty.body.byStatus).toEqual(Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])));
    expect(empty.body.byItPriority).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 0 });
    expect(empty.body.urgentTickets).toEqual({ total: 0, items: [] });
    expect(empty.body.recentlyUpdated).toEqual({ total: 0, items: [] });
  });

  it('API-28: each card count equals the total of the list its drill-down opens', async () => {
    await seedQueue();
    const d = (await dash(priyaCookie)).body;

    const total = async (query: string, cookie = priyaCookie) => {
      const res = await get(testServer.server, `/api/staff/tickets?${query}&pageSize=50`, cookie);
      expect(res.status, query).toBe(200);
      return res.body.totalItems as number;
    };

    expect(await total('owner=unassigned&scope=open')).toBe(d.metrics.unassigned);
    expect(await total('owner=me&scope=open')).toBe(d.metrics.ownedByMe);
    for (const s of ALL_STATUSES) {
      expect(await total(`status=${s}`), `status=${s}`).toBe(d.byStatus[s]);
    }
    for (const p of ['LOW', 'MEDIUM', 'HIGH']) {
      expect(await total(`itPriority=${p}&scope=open`), `itPriority=${p}`).toBe(d.byItPriority[p]);
    }
    expect(await total('itPriority=HIGH&scope=open')).toBe(d.metrics.urgent);
    expect(await total('myActions=true&scope=open')).toBe(d.myOpenActions.tickets);
    expect(await total('followUp=true&scope=open')).toBe(d.metrics.followUpsRequired);
    expect(await total('scope=recent&sort=updatedAt&direction=desc')).toBe(d.recentlyUpdated.total);

    // The same predicate holds for the Administrator caller (D-13), whose
    // `me` is a different user with no owned Tickets or Actions.
    const adminDash = (await dash(adminCookie)).body;
    expect(await total('owner=me&scope=open', adminCookie)).toBe(adminDash.metrics.ownedByMe);
    expect(await total('myActions=true&scope=open', adminCookie)).toBe(adminDash.myOpenActions.tickets);
    expect(adminDash.myOpenActions.tickets).toBe(0);
  });

  it('API-29: myActions=false, scope=bogus and followUp=1 are 400 INVALID_QUERY with fields on the staff queue', async () => {
    for (const [query, field] of [
      ['myActions=false', 'myActions'],
      ['scope=bogus', 'scope'],
      ['followUp=1', 'followUp'],
    ] as const) {
      const res = await get(testServer.server, `/api/staff/tickets?${query}`, priyaCookie);
      expect(res.status, query).toBe(400);
      expect(res.body.error).toBe('INVALID_QUERY');
      expect(res.body.fields.map((f: { field: string }) => f.field)).toContain(field);
    }
  });

  it('API-31: each userCounts role active + inactive equals the length of GET /api/users?role=<ROLE>', async () => {
    const d = (await dash(adminCookie)).body;
    for (const row of d.userCounts) {
      const list = await get(testServer.server, `/api/users?role=${row.role}`, adminCookie);
      expect(list.status).toBe(200);
      expect(list.body.length, row.role).toBe(row.active + row.inactive);
    }
  });
});
