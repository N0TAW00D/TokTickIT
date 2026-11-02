import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { loginAs, userByName } from './dashboardFixtures.js';
import type { ActionStatus, Priority, TicketStatus } from '../../src/generated/prisma/client.js';

// PERF-01 / PERF-02 (docs/lab-04/tests.md, AC-46): at 1,000 Tickets and 3,000
// Actions Taken the median response over 20 calls is under 500 ms. The median
// (not the mean or the best) is the row's own statistic: it ignores the one or
// two slow outliers a busy laptop produces without hiding a query that is
// slow every time. One untimed warm-up call per endpoint absorbs the cold
// connection and the first query plan. The volume data is created here and
// removed in afterAll, so the suite leaves the seeded database as it found it.

const testServer = useTestServer(app);

const TICKETS = 1000;
const ACTIONS = 3000;
const BIG_TICKET_ACTIONS = 200;
const CALLS = 20;
const LIMIT_MS = 500;

const STATUSES: TicketStatus[] = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_REQUESTER', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED'];
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH'];
const ACTION_STATUSES: ActionStatus[] = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

let cookies: { requester: string; staff: string; admin: string };
let bigTicketId: number;

async function seedVolume(): Promise<void> {
  const jennifer = await userByName('Jennifer Anderson');
  const priya = await userByName('Priya Natarajan');
  const requesters = await prisma.user.findMany({ where: { role: 'REQUESTER', isActive: true }, select: { id: true } });
  const staff = await prisma.user.findMany({ where: { role: 'IT_STAFF', isActive: true }, select: { id: true } });
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });

  const tickets = await prisma.ticket.createManyAndReturn({
    select: { id: true },
    data: Array.from({ length: TICKETS }, (_, i) => ({
      ticketNumber: `TKT-2026-8${String(i).padStart(5, '0')}`,
      // Half of the volume belongs to the Requester under test (worst case for their dashboard).
      requesterId: i % 2 === 0 ? jennifer.id : requesters[i % requesters.length]!.id,
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary: `Volume ticket ${i}`,
      description: 'Volume description for the performance smoke test.',
      requestedPriority: PRIORITIES[i % 3]!,
      itPriority: PRIORITIES[(i + 1) % 3]!,
      status: STATUSES[i % STATUSES.length]!,
      ownerId: i % 4 === 0 ? null : (i % 2 === 0 ? priya.id : staff[i % staff.length]!.id),
      updatedAt: new Date(Date.now() - (i % 10) * 86_400_000),
    })),
  });
  const ids = tickets.map((t) => t.id).sort((a, b) => a - b);
  bigTicketId = ids[0]!;

  const actions = Array.from({ length: ACTIONS }, (_, i) => {
    const status = ACTION_STATUSES[i % ACTION_STATUSES.length]!;
    const performer = staff[i % staff.length]!.id;
    return {
      ticketId: i < BIG_TICKET_ACTIONS ? bigTicketId : ids[i % ids.length]!,
      actionAt: new Date(Date.now() - i * 60_000),
      description: `Volume action ${i}`,
      result: status === 'COMPLETED' ? 'Done' : null,
      status,
      performedById: performer,
      assigneeId: i % 3 === 0 ? priya.id : null,
      lastUpdatedById: performer,
      followUpRequired: i % 5 === 0,
      followUpNote: i % 5 === 0 ? 'Check later' : null,
    };
  });
  await prisma.actionTaken.createMany({ data: actions });

  // Status history so the dashboards' history-based windows have rows to scan.
  await prisma.ticketStatusChange.createMany({
    data: ids.map((ticketId, i) => ({
      ticketId,
      fromStatus: 'IN_PROGRESS' as const,
      toStatus: i % 2 === 0 ? ('RESOLVED' as const) : ('CLOSED' as const),
      changedById: priya.id,
      changedAt: new Date(Date.now() - (i % 10) * 86_400_000),
    })),
  });
}

async function median(path: string, cookie: string): Promise<number> {
  const warm = await request(testServer.server).get(path).set('Cookie', cookie);
  expect(warm.status, `${path} warm-up`).toBe(200);
  const samples: number[] = [];
  for (let i = 0; i < CALLS; i += 1) {
    const start = performance.now();
    const res = await request(testServer.server).get(path).set('Cookie', cookie);
    samples.push(performance.now() - start);
    expect(res.status, path).toBe(200);
  }
  samples.sort((a, b) => a - b);
  return (samples[CALLS / 2 - 1]! + samples[CALLS / 2]!) / 2;
}

describe('performance smoke at volume (AC-46)', () => {
  // reset-db.ts truncates Ticket (and Session) before every test, so each
  // test seeds its own volume data and logs in again.
  beforeEach(async () => {
    await seedVolume();
    cookies = {
      requester: await loginAs(testServer.server, (await userByName('Jennifer Anderson')).email),
      staff: await loginAs(testServer.server, (await userByName('Priya Natarajan')).email),
      admin: await loginAs(testServer.server, (await userByName('Olivia Grant')).email),
    };
  }, 120_000);

  afterAll(async () => {
    await prisma.ticket.deleteMany({});
  });

  it('PERF-01: each dashboard endpoint has a median under 500 ms over 20 calls at 1,000 Tickets / 3,000 Actions', async () => {
    expect(await prisma.ticket.count()).toBe(TICKETS);
    expect(await prisma.actionTaken.count()).toBe(ACTIONS);
    const results = {
      requester: await median('/api/dashboard/requester', cookies.requester),
      staff: await median('/api/dashboard/staff', cookies.staff),
      admin: await median('/api/dashboard/staff', cookies.admin),
    };
    for (const [name, ms] of Object.entries(results)) {
      expect(ms, `${name} dashboard median ${ms.toFixed(1)} ms`).toBeLessThan(LIMIT_MS);
    }
  }, 120_000);

  it('PERF-02: a 200-Action Ticket list and the myActions=true queue have a median under 500 ms over 20 calls', async () => {
    expect(await prisma.actionTaken.count({ where: { ticketId: bigTicketId } })).toBeGreaterThanOrEqual(BIG_TICKET_ACTIONS);
    const list = await median(`/api/tickets/${bigTicketId}/actions-taken`, cookies.staff);
    const queue = await median('/api/staff/tickets?myActions=true', cookies.staff);
    expect(list, `actions list median ${list.toFixed(1)} ms`).toBeLessThan(LIMIT_MS);
    expect(queue, `myActions queue median ${queue.toFixed(1)} ms`).toBeLessThan(LIMIT_MS);
  }, 120_000);
});
