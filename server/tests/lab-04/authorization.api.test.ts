import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { createActionRow, createTicket, createUser, deleteUsers, loginCookie } from './helpers.js';

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
