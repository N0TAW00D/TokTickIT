import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/app.js';
import { useTestServer } from '../setup/http-server.js';
import {
  NOW, WINDOW_START, NOT_OPEN, UPDATED_RECENTLY, WINDOW_START_SQL,
  freezeClock, unfreezeClock, hoursBefore, userByName, loginAs, makeTicket, addHistory,
  sqlCount, sqlRecentlyResolvedIds, get,
} from './dashboardFixtures.js';

// GET /api/dashboard/requester — docs/lab-04/api-spec.md §4 (BR-20..BR-24,
// BR-30, BR-31). API-17..API-22. The clock is frozen at NOW and every
// expected value is recomputed with independent SQL, never by the service.

const testServer = useTestServer(app);

let jennifer: { id: number; email: string };
let michael: { id: number; email: string };
let david: { id: number; email: string };
let priya: { id: number; email: string };
let cookie: string;

beforeEach(async () => {
  freezeClock();
  jennifer = await userByName('Jennifer Anderson');
  michael = await userByName('Michael Brown');
  david = await userByName('David Lee');
  priya = await userByName('Priya Natarajan');
  cookie = await loginAs(testServer.server, jennifer.email);
});

afterEach(() => unfreezeClock());

async function seedMixed() {
  const day = 24;
  const t = {
    newer: await makeTicket({ requesterId: jennifer.id, status: 'NEW', updatedAt: hoursBefore(NOW, 1) }),
    inProgress: await makeTicket({ requesterId: jennifer.id, status: 'IN_PROGRESS', updatedAt: hoursBefore(NOW, 2 * day) }),
    waiting: await makeTicket({ requesterId: jennifer.id, status: 'WAITING_FOR_REQUESTER', updatedAt: hoursBefore(NOW, 3) }),
    resolvedRecent: await makeTicket({ requesterId: jennifer.id, status: 'RESOLVED', updatedAt: hoursBefore(NOW, 0.5) }),
    closedOldUpdate: await makeTicket({ requesterId: jennifer.id, status: 'CLOSED', updatedAt: hoursBefore(NOW, 40 * day) }),
    legacyResolved: await makeTicket({ requesterId: jennifer.id, status: 'RESOLVED', updatedAt: hoursBefore(NOW, 1) }),
    cancelled: await makeTicket({ requesterId: jennifer.id, status: 'CANCELLED', updatedAt: hoursBefore(NOW, 30 * day) }),
    resolvedLongAgo: await makeTicket({ requesterId: jennifer.id, status: 'RESOLVED', updatedAt: NOW }),
  };
  await addHistory(t.resolvedRecent.id, 'RESOLVED', priya.id, hoursBefore(NOW, day));
  await addHistory(t.closedOldUpdate.id, 'CLOSED', priya.id, hoursBefore(NOW, 2 * day));
  await addHistory(t.resolvedLongAgo.id, 'RESOLVED', priya.id, hoursBefore(NOW, 20 * day));
  // Someone else's tickets in every interesting state must never be counted.
  const m1 = await makeTicket({ requesterId: michael.id, status: 'WAITING_FOR_REQUESTER', updatedAt: NOW });
  const m2 = await makeTicket({ requesterId: michael.id, status: 'RESOLVED', updatedAt: NOW });
  await addHistory(m2.id, 'RESOLVED', priya.id, hoursBefore(NOW, 1));
  return { ...t, m1, m2 };
}

describe('GET /api/dashboard/requester', () => {
  it('API-17: openTickets, waitingForMe, recentlyUpdated and recentlyResolved equal independent SQL; envelope carries generatedAt, timeZone, windowStart', async () => {
    const t = await seedMixed();

    const res = await get(testServer.server, '/api/dashboard/requester', cookie);
    expect(res.status).toBe(200);

    expect(res.body.generatedAt).toBe(NOW.toISOString());
    expect(res.body.timeZone).toBe('Asia/Bangkok');
    expect(res.body.windowStart).toBe(WINDOW_START.toISOString());

    const open = await sqlCount(`SELECT count(*) AS v FROM "Ticket" WHERE "requesterId" = $1 AND status NOT IN ${NOT_OPEN}`, jennifer.id);
    const waiting = await sqlCount(`SELECT count(*) AS v FROM "Ticket" WHERE "requesterId" = $1 AND status = 'WAITING_FOR_REQUESTER'`, jennifer.id);
    const recent = await sqlCount(
      `SELECT count(*) AS v FROM "Ticket" WHERE "requesterId" = $2 AND ${UPDATED_RECENTLY}`, NOW.toISOString(), jennifer.id);
    const resolvedIds = await sqlRecentlyResolvedIds(jennifer.id, NOW);

    // Hand-checked sanity so a wrong SQL cannot silently agree with a wrong service.
    expect(open).toBe(3);
    expect(waiting).toBe(1);
    expect(resolvedIds).toEqual([t.resolvedRecent.id, t.closedOldUpdate.id].sort((a, b) => a - b));

    expect(res.body.metrics).toEqual({ openTickets: open, waitingForMe: waiting });
    expect(res.body.recentlyUpdated.total).toBe(recent);
    expect(res.body.recentlyResolved.total).toBe(resolvedIds.length);
    expect(res.body.recentlyResolved.items.map((i: { id: number }) => i.id).sort((a: number, b: number) => a - b)).toEqual(resolvedIds);

    // The legacy Resolved Ticket (no history, recent updatedAt) is NOT recently resolved (BR-23, D-10).
    const resolvedItemIds = res.body.recentlyResolved.items.map((i: { id: number }) => i.id);
    expect(resolvedItemIds).not.toContain(t.legacyResolved.id);
    expect(resolvedItemIds).not.toContain(t.resolvedLongAgo.id);

    const closed = res.body.recentlyResolved.items.find((i: { id: number }) => i.id === t.closedOldUpdate.id);
    expect(closed.resolvedAt).toBe(hoursBefore(NOW, 48).toISOString());
    expect(Object.keys(closed).sort()).toEqual(['id', 'resolvedAt', 'status', 'summary', 'ticketNumber', 'updatedAt']);
    expect(Object.keys(res.body.recentlyUpdated.items[0]).sort()).toEqual(['id', 'status', 'summary', 'ticketNumber', 'updatedAt']);
  });

  it('API-18: another Requester\'s Tickets are never counted or listed, and a requesterId query value is ignored', async () => {
    const t = await seedMixed();

    const res = await get(testServer.server, `/api/dashboard/requester?requesterId=${michael.id}`, cookie);
    expect(res.status).toBe(200);

    const ids = [...res.body.recentlyUpdated.items, ...res.body.recentlyResolved.items].map((i: { id: number }) => i.id);
    expect(ids).not.toContain(t.m1.id);
    expect(ids).not.toContain(t.m2.id);
    expect(res.body.metrics.waitingForMe).toBe(1); // Jennifer's one, not Michael's
    expect(res.body.recentlyResolved.total).toBe(2);

    // Michael's own dashboard sees only his two Tickets.
    const michaelCookie = await loginAs(testServer.server, michael.email);
    const mine = await get(testServer.server, '/api/dashboard/requester', michaelCookie);
    expect(mine.body.metrics).toEqual({ openTickets: 1, waitingForMe: 1 });
    expect(mine.body.recentlyUpdated.total).toBe(2);
    expect(mine.body.recentlyResolved.total).toBe(1);
  });

  it('API-19: seven recent Tickets give 5 items, total 7, ordered updatedAt desc then id desc, with no itPriority', async () => {
    const same = hoursBefore(NOW, 5);
    const made = [];
    for (let i = 0; i < 5; i++) {
      made.push(await makeTicket({ requesterId: jennifer.id, status: 'OPEN', updatedAt: hoursBefore(NOW, 10 + i) }));
    }
    // Two tickets tie on updatedAt: higher id must come first.
    const tieLow = await makeTicket({ requesterId: jennifer.id, status: 'OPEN', itPriority: 'HIGH', updatedAt: same });
    const tieHigh = await makeTicket({ requesterId: jennifer.id, status: 'OPEN', itPriority: 'HIGH', updatedAt: same });

    const res = await get(testServer.server, '/api/dashboard/requester', cookie);
    expect(res.status).toBe(200);
    expect(res.body.recentlyUpdated.total).toBe(7);
    const items = res.body.recentlyUpdated.items;
    expect(items).toHaveLength(5);
    expect(items.map((i: { id: number }) => i.id)).toEqual([
      tieHigh.id, tieLow.id, made[0]!.id, made[1]!.id, made[2]!.id,
    ]);
    for (const item of items) {
      expect(item).not.toHaveProperty('itPriority');
      expect(item).not.toHaveProperty('owner');
    }
  });

  it('API-20: a Requester with no Tickets (David Lee) gets 200 with zero counts and empty lists', async () => {
    await seedMixed();
    const davidCookie = await loginAs(testServer.server, david.email);

    const res = await get(testServer.server, '/api/dashboard/requester', davidCookie);
    expect(res.status).toBe(200);
    expect(res.body.metrics).toEqual({ openTickets: 0, waitingForMe: 0 });
    expect(res.body.recentlyUpdated).toEqual({ total: 0, items: [] });
    expect(res.body.recentlyResolved).toEqual({ total: 0, items: [] });
    expect(res.body.windowStart).toBe(WINDOW_START.toISOString());
  });

  it('API-21: a Ticket updated 1 s before windowStart is excluded, one at windowStart is included', async () => {
    const before = await makeTicket({ requesterId: jennifer.id, status: 'OPEN', updatedAt: new Date(WINDOW_START.getTime() - 1000) });
    const at = await makeTicket({ requesterId: jennifer.id, status: 'OPEN', updatedAt: WINDOW_START });
    // Resolution boundary follows the same rule, on the history row's changedAt.
    const resBefore = await makeTicket({ requesterId: jennifer.id, status: 'RESOLVED', updatedAt: NOW });
    const resAt = await makeTicket({ requesterId: jennifer.id, status: 'RESOLVED', updatedAt: NOW });
    await addHistory(resBefore.id, 'RESOLVED', priya.id, new Date(WINDOW_START.getTime() - 1000));
    await addHistory(resAt.id, 'RESOLVED', priya.id, WINDOW_START);

    const res = await get(testServer.server, '/api/dashboard/requester', cookie);
    const updatedIds = res.body.recentlyUpdated.items.map((i: { id: number }) => i.id);
    expect(updatedIds).toContain(at.id);
    expect(updatedIds).not.toContain(before.id);
    const resolvedIds = res.body.recentlyResolved.items.map((i: { id: number }) => i.id);
    expect(resolvedIds).toEqual([resAt.id]);

    // Independent SQL agrees about the boundary.
    expect(await sqlCount(
      `SELECT count(*) AS v FROM "Ticket" WHERE id = $2 AND ("updatedAt" AT TIME ZONE 'UTC') >= ${WINDOW_START_SQL}`,
      NOW.toISOString(), before.id)).toBe(0);
  });

  it('API-22: each drill-down list total equals the dashboard value and lists only own Tickets', async () => {
    await seedMixed();
    const dash = (await get(testServer.server, '/api/dashboard/requester', cookie)).body;

    const cases: [string, number][] = [
      ['scope=open', dash.metrics.openTickets],
      ['status=WAITING_FOR_REQUESTER', dash.metrics.waitingForMe],
      ['scope=recent&sort=updatedAt&order=desc', dash.recentlyUpdated.total],
      ['scope=recently-resolved', dash.recentlyResolved.total],
    ];
    for (const [query, expected] of cases) {
      const res = await get(testServer.server, `/api/tickets?${query}&pageSize=50`, cookie);
      expect(res.status, query).toBe(200);
      expect(res.body.meta.totalItems, query).toBe(expected);
      expect(res.body.items.length, query).toBe(expected);
      const owners = await sqlCount(
        `SELECT count(*) AS v FROM "Ticket" WHERE id = ANY($1::int[]) AND "requesterId" <> $2`,
        res.body.items.map((i: { id: number }) => i.id), jennifer.id);
      expect(owners, `${query} lists only own tickets`).toBe(0);
    }
  });

  it('SEC-05 (dashboard part): a body is ignored; identity comes from the session', async () => {
    await seedMixed();
    const res = await get(testServer.server, `/api/dashboard/requester?requesterId=${david.id}`, cookie);
    expect(res.body.metrics.openTickets).toBe(3);
  });
});
