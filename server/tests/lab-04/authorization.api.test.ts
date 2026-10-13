import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { createActionRow, createTicket, createUser, deleteUsers, loginCookie } from './helpers.js';
import { freezeClock, unfreezeClock, userByName, loginAs, get } from './dashboardFixtures.js';

describe('Actions Taken routes', () => {
  // Issue #94 phase B: the Actions Taken rows of tests.md's authorization
  // suite (HTTP layer only) - SEC-01, SEC-02 (Actions part and the retained
  // Administrator limits), SEC-04, SEC-05, SEC-06, SEC-07 for the three Action
  // routes. Dashboard, status-history and staff-queue rows belong to later
  // Issues and are added to this file there.

  const testServer = useTestServer(app);

  type User = Awaited<ReturnType<typeof createUser>>;
  let userIds: number[] = [];
  let requester: User;
  let other: User;
  let staff: User;
  let admin: User;
  let cookies: { requester: string; other: string; staff: string; admin: string };

  async function mk(role: 'REQUESTER' | 'IT_STAFF' | 'ADMINISTRATOR') {
    const u = await createUser(role);
    userIds.push(u.id);
    return u;
  }

  beforeEach(async () => {
    requester = await mk('REQUESTER');
    other = await mk('REQUESTER');
    staff = await mk('IT_STAFF');
    admin = await mk('ADMINISTRATOR');
    cookies = {
      requester: await loginCookie(testServer.server, requester.email),
      other: await loginCookie(testServer.server, other.email),
      staff: await loginCookie(testServer.server, staff.email),
      admin: await loginCookie(testServer.server, admin.email),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.ticket.deleteMany({});
    await deleteUsers(userIds);
    userIds = [];
  });

  const json = (r: request.Test) => r.set('Content-Type', 'application/json');

  describe('SEC-01: a Requester cannot write Actions Taken', () => {
    it('own Ticket: POST/PATCH 403, nothing written', async () => {
      const ticket = await createTicket(requester.id);
      const row = await createActionRow(ticket.id, staff.id);
      const post = await json(request(testServer.server).post(`/api/tickets/${ticket.id}/actions-taken`).set('Cookie', cookies.requester)).send({ description: 'x' });
      expect(post.status).toBe(403);
      expect(post.body.error).toBe('FORBIDDEN');
      const patch = await json(request(testServer.server).patch(`/api/tickets/${ticket.id}/actions-taken/${row.id}`).set('Cookie', cookies.requester)).send({ version: 1, description: 'hacked' });
      expect(patch.status).toBe(403);
      expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
      expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: row.id } })).description).toBe('Seeded action');
    });

    it("another Requester's Ticket: read/write 404 byte-identical to a nonexistent Ticket, nothing written", async () => {
      const ticket = await createTicket(requester.id);
      const row = await createActionRow(ticket.id, staff.id);
      const missingId = 99999999;
      const pairs: Array<[string, (id: number, actionId: number) => request.Test]> = [
        ['GET', (id) => request(testServer.server).get(`/api/tickets/${id}/actions-taken`).set('Cookie', cookies.other)],
        ['POST', (id) => json(request(testServer.server).post(`/api/tickets/${id}/actions-taken`).set('Cookie', cookies.other)).send({ description: 'x' })],
        ['PATCH', (id, a) => json(request(testServer.server).patch(`/api/tickets/${id}/actions-taken/${a}`).set('Cookie', cookies.other)).send({ version: 1, description: 'x' })],
      ];
      for (const [label, call] of pairs) {
        const foreign = await call(ticket.id, row.id);
        const missing = await call(missingId, row.id);
        expect(foreign.status, label).toBe(404);
        expect(foreign.text, label).toBe(missing.text);
      }
      expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
    });
  });

  describe('SEC-02: Administrator Actions access and retained limits', () => {
    it('Administrator POST 201, PATCH 200, GET 200', async () => {
      const ticket = await createTicket(requester.id);
      const created = await json(request(testServer.server).post(`/api/tickets/${ticket.id}/actions-taken`).set('Cookie', cookies.admin)).send({ description: 'admin work' });
      expect(created.status).toBe(201);
      expect(created.body.performedBy).toMatchObject({ id: admin.id, role: 'ADMINISTRATOR' });
      const patched = await json(request(testServer.server).patch(`/api/tickets/${ticket.id}/actions-taken/${created.body.id}`).set('Cookie', cookies.admin)).send({ version: 1, description: 'edited' });
      expect(patched.status).toBe(200);
      expect((await request(testServer.server).get(`/api/tickets/${ticket.id}/actions-taken`).set('Cookie', cookies.admin)).status).toBe(200);
    });

    it('Administrator status change, owner change and note creation are still 403', async () => {
      const ticket = await createTicket(requester.id, { status: 'OPEN' });
      const call = (method: 'patch' | 'post', path: string, body: object) =>
        json(request(testServer.server)[method](`/api/tickets/${ticket.id}/${path}`).set('Cookie', cookies.admin)).send(body);
      expect((await call('patch', 'status', { status: 'IN_PROGRESS', version: 1 })).status).toBe(403);
      expect((await call('patch', 'owner', { ownerId: staff.id, version: 1 })).status).toBe(403);
      expect((await call('post', 'notes', { body: 'internal note' })).status).toBe(403);
    });
  });

  describe('SEC-04: unauthenticated and password-gated Action routes', () => {
    it('no session -> 401 and no write', async () => {
      const ticket = await createTicket(requester.id);
      const row = await createActionRow(ticket.id, staff.id);
      expect((await request(testServer.server).get(`/api/tickets/${ticket.id}/actions-taken`)).status).toBe(401);
      expect((await json(request(testServer.server).post(`/api/tickets/${ticket.id}/actions-taken`)).send({ description: 'x' })).status).toBe(401);
      expect((await json(request(testServer.server).patch(`/api/tickets/${ticket.id}/actions-taken/${row.id}`)).send({ version: 1, description: 'x' })).status).toBe(401);
      expect(await prisma.actionTaken.count()).toBe(1);
    });

    it('mustChangePassword -> 403 PASSWORD_CHANGE_REQUIRED on each route', async () => {
      await prisma.user.update({ where: { id: staff.id }, data: { mustChangePassword: true } });
      const ticket = await createTicket(requester.id);
      const row = await createActionRow(ticket.id, staff.id);
      const results = [
        await request(testServer.server).get(`/api/tickets/${ticket.id}/actions-taken`).set('Cookie', cookies.staff),
        await json(request(testServer.server).post(`/api/tickets/${ticket.id}/actions-taken`).set('Cookie', cookies.staff)).send({ description: 'x' }),
        await json(request(testServer.server).patch(`/api/tickets/${ticket.id}/actions-taken/${row.id}`).set('Cookie', cookies.staff)).send({ version: 1, description: 'x' }),
      ];
      for (const r of results) {
        expect(r.status).toBe(403);
        expect(r.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
      }
      expect(await prisma.actionTaken.count()).toBe(1);
    });
  });

  describe('SEC-05: identity from the session only', () => {
    it('body/query requesterId and performedById never change whose data is read or written', async () => {
      const ticket = await createTicket(requester.id);
      const foreignTicket = await createTicket(other.id);
      const created = await json(
        request(testServer.server).post(`/api/tickets/${ticket.id}/actions-taken?requesterId=${other.id}&performedById=${admin.id}`).set('Cookie', cookies.staff),
      ).send({ description: 'x', requesterId: other.id, performedById: admin.id, performedBy: { id: admin.id } });
      expect(created.status).toBe(201);
      expect(created.body.performedBy.id).toBe(staff.id);
      // A Requester cannot read another's Ticket by passing that user's id.
      const read = await request(testServer.server)
        .get(`/api/tickets/${foreignTicket.id}/actions-taken?requesterId=${other.id}`)
        .set('Cookie', cookies.requester)
        .set('X-Requester-Id', String(other.id));
      expect(read.status).toBe(404);
    });
  });

  describe('SEC-06: safe failure on the Action routes', () => {
    it('a forced internal error returns the generic INTERNAL body - no stack, SQL or path', async () => {
      const ticket = await createTicket(requester.id);
      const row = await createActionRow(ticket.id, staff.id);
      vi.spyOn(prisma.ticket, 'findUnique').mockRejectedValue(new Error('SELECT secret FROM /var/db/pg.sock failed at Object.<anonymous> (/srv/app.ts:1:1)'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const results = [
        await request(testServer.server).get(`/api/tickets/${ticket.id}/actions-taken`).set('Cookie', cookies.staff),
        await json(request(testServer.server).post(`/api/tickets/${ticket.id}/actions-taken`).set('Cookie', cookies.staff)).send({ description: 'x' }),
        await json(request(testServer.server).patch(`/api/tickets/${ticket.id}/actions-taken/${row.id}`).set('Cookie', cookies.staff)).send({ version: 1, description: 'x' }),
      ];
      for (const r of results) {
        expect(r.status).toBe(500);
        expect(r.body).toEqual({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
        expect(r.text).not.toMatch(/SELECT|\/srv|\/var|at Object/);
      }
    });
  });

  describe('SEC-07: content-type enforcement', () => {
    it('text/plain on POST and PATCH -> 415, nothing written', async () => {
      const ticket = await createTicket(requester.id);
      const row = await createActionRow(ticket.id, staff.id);
      const post = await request(testServer.server).post(`/api/tickets/${ticket.id}/actions-taken`).set('Cookie', cookies.staff).set('Content-Type', 'text/plain').send('description=x');
      const patch = await request(testServer.server).patch(`/api/tickets/${ticket.id}/actions-taken/${row.id}`).set('Cookie', cookies.staff).set('Content-Type', 'text/plain').send('version=1');
      expect(post.status).toBe(415);
      expect(patch.status).toBe(415);
      expect(post.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(await prisma.actionTaken.count()).toBe(1);
    });
  });
});

// The remaining Lab 4 routes (history, workflow, dashboards, staff queue and the
// Lab 4 changes to the ticket reads) get the same cross-cutting SEC rows as the
// Actions Taken routes above: SEC-04 (401 / password gate), SEC-06 (safe
// failure) and SEC-07 (content type).
describe('Every other Lab 4 route', () => {
  type User = Awaited<ReturnType<typeof createUser>>;
  let userIds: number[] = [];
  let requester: User;
  let staff: User;
  let admin: User;
  let cookies: { requester: string; staff: string; admin: string };
  let ticketId: number;

  beforeEach(async () => {
    requester = await createUser('REQUESTER');
    staff = await createUser('IT_STAFF');
    admin = await createUser('ADMINISTRATOR');
    userIds = [requester.id, staff.id, admin.id];
    cookies = {
      requester: await loginCookie(testServer.server, requester.email),
      staff: await loginCookie(testServer.server, staff.email),
      admin: await loginCookie(testServer.server, admin.email),
    };
    ticketId = (await createTicket(requester.id, { status: 'OPEN' })).id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.ticket.deleteMany({});
    await deleteUsers(userIds);
    userIds = [];
  });

  type Method = 'get' | 'patch';
  interface Route {
    label: string;
    method: Method;
    path: () => string;
    body?: () => object;
    cookie: 'requester' | 'staff';
  }
  const send = (r: Route, cookie?: string, contentType = 'application/json') => {
    let call = request(testServer.server)[r.method](r.path());
    if (cookie) call = call.set('Cookie', cookie);
    if (r.method === 'patch') call = call.set('Content-Type', contentType);
    return r.method === 'patch' ? call.send(contentType === 'application/json' ? (r.body?.() ?? {}) : 'plain=body') : call;
  };

  // Routes added or changed by Lab 4 beyond the Actions Taken ones above.
  const readRoutes: Route[] = [
    { label: 'GET /api/tickets/:id/status-history', method: 'get', path: () => `/api/tickets/${ticketId}/status-history`, cookie: 'staff' },
    { label: 'GET /api/tickets/:id', method: 'get', path: () => `/api/tickets/${ticketId}`, cookie: 'staff' },
    { label: 'GET /api/tickets', method: 'get', path: () => '/api/tickets?scope=open', cookie: 'requester' },
    { label: 'GET /api/dashboard/requester', method: 'get', path: () => '/api/dashboard/requester', cookie: 'requester' },
    { label: 'GET /api/dashboard/staff', method: 'get', path: () => '/api/dashboard/staff', cookie: 'staff' },
    { label: 'GET /api/staff/tickets', method: 'get', path: () => '/api/staff/tickets', cookie: 'staff' },
    { label: 'GET /api/staff/assignable-users', method: 'get', path: () => '/api/staff/assignable-users', cookie: 'staff' },
  ];
  const writeRoutes: Route[] = [
    { label: 'PATCH /api/tickets/:id/status', method: 'patch', path: () => `/api/tickets/${ticketId}/status`, body: () => ({ status: 'IN_PROGRESS', version: 1 }), cookie: 'staff' },
    { label: 'PATCH /api/tickets/:id/owner', method: 'patch', path: () => `/api/tickets/${ticketId}/owner`, body: () => ({ ownerId: staff.id, version: 1 }), cookie: 'staff' },
    { label: 'PATCH /api/tickets/:id/it-priority', method: 'patch', path: () => `/api/tickets/${ticketId}/it-priority`, body: () => ({ itPriority: 'HIGH', version: 1 }), cookie: 'staff' },
  ];
  const allRoutes = [...readRoutes, ...writeRoutes];

  async function snapshot() {
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    return { status: t.status, ownerId: t.ownerId, itPriority: t.itPriority, version: t.version, history: await prisma.ticketStatusChange.count() };
  }

  it('SEC-04: every Lab 4 route without a session is 401 and writes nothing', async () => {
    const before = await snapshot();
    for (const r of allRoutes) {
      const res = await send(r);
      expect(res.status, r.label).toBe(401);
      expect(res.body.error, r.label).toBe('UNAUTHENTICATED');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('SEC-04: every Lab 4 route with mustChangePassword is 403 PASSWORD_CHANGE_REQUIRED and writes nothing', async () => {
    await prisma.user.updateMany({ where: { id: { in: [requester.id, staff.id] } }, data: { mustChangePassword: true } });
    const before = await snapshot();
    for (const r of allRoutes) {
      const res = await send(r, cookies[r.cookie]);
      expect(res.status, r.label).toBe(403);
      expect(res.body.error, r.label).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('SEC-05: status history is attributed to the session user, and dashboards ignore a supplied requesterId', async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { ownerId: staff.id } });
    const res = await request(testServer.server)
      .patch(`/api/tickets/${ticketId}/status?changedById=${admin.id}`)
      .set('Cookie', cookies.staff)
      .set('Content-Type', 'application/json')
      .send({ status: 'IN_PROGRESS', version: 1, changedById: admin.id, requesterId: admin.id });
    expect(res.status).toBe(200);
    const rows = await prisma.ticketStatusChange.findMany({ where: { ticketId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changedById).toBe(staff.id);
    const dash = await request(testServer.server).get(`/api/dashboard/requester?requesterId=${admin.id}`).set('Cookie', cookies.requester);
    expect(dash.status).toBe(200);
    const mine = await request(testServer.server).get('/api/dashboard/requester').set('Cookie', cookies.requester);
    expect({ ...dash.body, generatedAt: null }).toEqual({ ...mine.body, generatedAt: null });
  });

  it('SEC-06: a forced internal error on each of these routes returns the generic INTERNAL body', async () => {
    const boom = () => Promise.reject(new Error('SELECT secret FROM /var/db/pg.sock failed at Object.<anonymous> (/srv/app.ts:1:1)'));
    // Only data-access methods are broken; session lookup (authenticate) is untouched.
    for (const m of ['findUnique', 'findFirst', 'findMany', 'count', 'update', 'updateMany', 'groupBy'] as const) {
      vi.spyOn(prisma.ticket, m as 'findMany').mockImplementation(boom as never);
    }
    vi.spyOn(prisma.ticketStatusChange, 'findMany').mockImplementation(boom as never);
    vi.spyOn(prisma.user, 'findMany').mockImplementation(boom as never);
    vi.spyOn(prisma, '$queryRaw').mockImplementation(boom as never);
    vi.spyOn(prisma, '$queryRawUnsafe').mockImplementation(boom as never);
    vi.spyOn(prisma, '$transaction').mockImplementation(boom as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const r of allRoutes) {
      const res = await send(r, cookies[r.cookie]);
      expect(res.status, r.label).toBe(500);
      expect(res.body, r.label).toEqual({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
      expect(res.text, r.label).not.toMatch(/SELECT|\/srv|\/var|at Object/);
    }
  });

  it('SEC-07: text/plain on every new state-changing route is 415 and writes nothing', async () => {
    const before = await snapshot();
    for (const r of writeRoutes) {
      const res = await send(r, cookies[r.cookie], 'text/plain');
      expect(res.status, r.label).toBe(415);
      expect(res.body.error, r.label).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('Dashboards and the staff queue', () => {
  // Lab 4 authorization matrix (docs/lab-04/tests.md SEC-*). This file holds the
  // dashboard and D-13 queue rows; Actions / workflow rows land with their issues.

  const testServer = useTestServer(app);

  let cookies: { requester: string; staff: string; admin: string };

  beforeEach(async () => {
    freezeClock();
    cookies = {
      requester: await loginAs(testServer.server, (await userByName('Jennifer Anderson')).email),
      staff: await loginAs(testServer.server, (await userByName('Priya Natarajan')).email),
      admin: await loginAs(testServer.server, (await userByName('Olivia Grant')).email),
    };
  });

  afterEach(() => unfreezeClock());

  describe('Lab 4 authorization: dashboards and the staff queue', () => {
    it('SEC-03: Requester gets 403 on the staff dashboard; IT Staff and Administrator get 403 on the requester dashboard; permitted pairs are 200', async () => {
      const s = testServer.server;
      for (const [path, cookie, status] of [
        ['/api/dashboard/staff', cookies.requester, 403],
        ['/api/dashboard/requester', cookies.staff, 403],
        ['/api/dashboard/requester', cookies.admin, 403],
        ['/api/dashboard/requester', cookies.requester, 200],
        ['/api/dashboard/staff', cookies.staff, 200],
        ['/api/dashboard/staff', cookies.admin, 200],
      ] as const) {
        const res = await get(s, path, cookie);
        expect(res.status, `${path} as ${cookie.slice(0, 12)}`).toBe(status);
        if (status === 403) {
          expect(res.body.error).toBe('FORBIDDEN');
          expect(res.body).not.toHaveProperty('metrics');
        }
      }
      // No session is 401 on both.
      expect((await get(s, '/api/dashboard/requester')).status).toBe(401);
      expect((await get(s, '/api/dashboard/staff')).status).toBe(401);
    });

    it('SEC-08: GET /api/staff/tickets and /api/staff/assignable-users are 403 for a Requester and 200 for an Administrator', async () => {
      const s = testServer.server;
      for (const path of ['/api/staff/tickets', '/api/staff/assignable-users']) {
        const requester = await get(s, path, cookies.requester);
        expect(requester.status, `${path} requester`).toBe(403);
        expect(requester.body.error).toBe('FORBIDDEN');
        expect((await get(s, path, cookies.admin)).status, `${path} admin`).toBe(200);
        expect((await get(s, path, cookies.staff)).status, `${path} staff`).toBe(200);
      }
    });
  });
});
