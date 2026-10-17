import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { useTestServer } from '../setup/http-server.js';
import { createActionRow, createTicket, createUser, deleteUsers, loginCookie } from './helpers.js';

// Issue #94 phase B: Actions Taken API (docs/lab-04/api-spec.md §1.3, §1.4,
// §2.1-2.4). tests.md rows API-01..API-15, API-32, API-33.

const testServer = useTestServer(app);

type User = Awaited<ReturnType<typeof createUser>>;

let userIds: number[] = [];
let requester: User;
let staff: User;
let staff2: User;
let admin: User;
let staffCookie: string;
let staff2Cookie: string;
let adminCookie: string;
let requesterCookie: string;

async function mk(role: 'REQUESTER' | 'IT_STAFF' | 'ADMINISTRATOR', options: { isActive?: boolean } = {}) {
  const u = await createUser(role, options);
  userIds.push(u.id);
  return u;
}

beforeEach(async () => {
  requester = await mk('REQUESTER');
  staff = await mk('IT_STAFF');
  staff2 = await mk('IT_STAFF');
  admin = await mk('ADMINISTRATOR');
  staffCookie = await loginCookie(testServer.server, staff.email);
  staff2Cookie = await loginCookie(testServer.server, staff2.email);
  adminCookie = await loginCookie(testServer.server, admin.email);
  requesterCookie = await loginCookie(testServer.server, requester.email);
});

afterEach(async () => {
  await prisma.ticket.deleteMany({});
  await deleteUsers(userIds);
  userIds = [];
});

const base = (ticketId: number) => `/api/tickets/${ticketId}/actions-taken`;

function post(ticketId: number, cookie: string, body: unknown) {
  return request(testServer.server).post(base(ticketId)).set('Cookie', cookie).set('Content-Type', 'application/json').send(body as object);
}
function patch(ticketId: number, actionId: number | string, cookie: string, body: unknown) {
  return request(testServer.server)
    .patch(`${base(ticketId)}/${actionId}`)
    .set('Cookie', cookie)
    .set('Content-Type', 'application/json')
    .send(body as object);
}
/** A request with a JSON Content-Type but neither Content-Length nor Transfer-Encoding (no body at all). */
function rawBodiless(method: 'POST' | 'PATCH', path: string, cookie: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const { port } = testServer.server.address() as AddressInfo;
    const socket = connect(port, '127.0.0.1');
    let data = '';
    socket.on('data', (c) => (data += c.toString()));
    socket.on('error', reject);
    socket.on('close', () => resolve({ status: Number(data.split(' ')[1]), body: data.split('\r\n\r\n').slice(1).join('') }));
    socket.write(`${method} ${path} HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n`);
  });
}
function list(ticketId: number, cookie: string) {
  return request(testServer.server).get(base(ticketId)).set('Cookie', cookie);
}

describe('POST /api/tickets/:id/actions-taken', () => {
  it('API-01: creates an Action, session-owned, touching Ticket updatedAt but not version', async () => {
    const assignee = await mk('IT_STAFF');
    const ticket = await createTicket(requester.id);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date('2026-01-01T00:00:00Z') } });
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

    const res = await post(ticket.id, staffCookie, {
      description: '  Reset the VPN profile.  ',
      result: 'Reconnected',
      status: 'COMPLETED',
      assigneeId: assignee.id,
      followUpRequired: true,
      followUpNote: 'Check Friday',
      attachmentNotes: 'See screenshot',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketId: ticket.id,
      description: 'Reset the VPN profile.',
      result: 'Reconnected',
      status: 'COMPLETED',
      performedBy: { id: staff.id, name: staff.name, role: 'IT_STAFF' },
      assignee: { id: assignee.id, name: assignee.name },
      followUpRequired: true,
      followUpNote: 'Check Friday',
      attachmentNotes: 'See screenshot',
      lastUpdatedBy: { id: staff.id, name: staff.name },
      version: 1,
    });
    expect(res.body).not.toHaveProperty('clientRequestId');
    expect(res.body).not.toHaveProperty('clientRequestHash');
    expect(typeof res.body.actionAt).toBe('string');
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.version).toBe(before.version);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it('API-01: defaults - PLANNED, null optionals, followUpRequired false', async () => {
    const ticket = await createTicket(requester.id);
    const res = await post(ticket.id, staffCookie, { description: 'Plan it' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'PLANNED',
      result: null,
      assignee: null,
      followUpRequired: false,
      followUpNote: null,
      attachmentNotes: null,
    });
  });

  it('API-02: client performedBy/lastUpdatedBy/createdAt/ticketId/id/version are ignored on create', async () => {
    const ticket = await createTicket(requester.id);
    const other = await createTicket(requester.id);
    const res = await post(ticket.id, staffCookie, {
      description: 'x',
      performedBy: { id: staff2.id },
      performedById: staff2.id,
      lastUpdatedBy: { id: staff2.id },
      lastUpdatedById: staff2.id,
      createdAt: '2000-01-01T00:00:00Z',
      ticketId: other.id,
      id: 99999,
      version: 42,
    });
    expect(res.status).toBe(201);
    expect(res.body.performedBy.id).toBe(staff.id);
    expect(res.body.lastUpdatedBy.id).toBe(staff.id);
    expect(res.body.ticketId).toBe(ticket.id);
    expect(res.body.id).not.toBe(99999);
    expect(res.body.version).toBe(1);
    expect(res.body.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('API-03: invalid description/result each 400 VALIDATION_FAILED naming the field, nothing written', async () => {
    const ticket = await createTicket(requester.id);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ description: '' }, 'description'],
      [{ description: '   ' }, 'description'],
      [{ description: 'x'.repeat(2001) }, 'description'],
      [{ description: 'ok', result: 'y'.repeat(2001) }, 'result'],
    ];
    for (const [body, field] of cases) {
      const res = await post(ticket.id, staffCookie, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');
      expect(res.body.fields.map((f: { field: string }) => f.field)).toContain(field);
    }
    const ok = await post(ticket.id, staffCookie, { description: 'x'.repeat(2000) });
    expect(ok.status).toBe(201);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it('API-03: reports every invalid field at once', async () => {
    const ticket = await createTicket(requester.id);
    const res = await post(ticket.id, staffCookie, { description: '', status: 'BOGUS', followUpRequired: true });
    expect(res.status).toBe(400);
    const fields = res.body.fields.map((f: { field: string }) => f.field);
    expect(fields).toEqual(expect.arrayContaining(['description', 'status', 'followUpNote']));
    expect(await prisma.actionTaken.count()).toBe(0);
  });

  it('API-04: future actionAt 400 for IN_PROGRESS/COMPLETED, 201 for PLANNED; pre-creation 400; default now', async () => {
    const ticket = await createTicket(requester.id);
    const future = new Date(Date.now() + 3 * 3600_000).toISOString();
    for (const status of ['IN_PROGRESS', 'COMPLETED']) {
      const res = await post(ticket.id, staffCookie, { description: 'x', status, result: 'r', actionAt: future });
      expect(res.status).toBe(400);
      expect(res.body.fields.map((f: { field: string }) => f.field)).toContain('actionAt');
    }
    const planned = await post(ticket.id, staffCookie, { description: 'x', status: 'PLANNED', actionAt: future });
    expect(planned.status).toBe(201);
    expect(planned.body.actionAt).toBe(future);

    const before = new Date(ticket.createdAt.getTime() - 60_000).toISOString();
    const pre = await post(ticket.id, staffCookie, { description: 'x', actionAt: before });
    expect(pre.status).toBe(400);

    const t0 = Date.now();
    const dflt = await post(ticket.id, staffCookie, { description: 'x' });
    expect(dflt.status).toBe(201);
    expect(Math.abs(new Date(dflt.body.actionAt).getTime() - t0)).toBeLessThan(10_000);
  });

  it('API-04: PATCH of a future PLANNED Action to COMPLETED is 400', async () => {
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id, { actionAt: new Date(Date.now() + 3600_000) });
    const res = await patch(ticket.id, row.id, staffCookie, { version: 1, status: 'IN_PROGRESS' });
    expect(res.status).toBe(400);
    expect(res.body.fields.map((f: { field: string }) => f.field)).toContain('actionAt');
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe('PLANNED');
    expect(stored.version).toBe(1);
  });

  it('API-05: follow-up rules; PATCH flag off clears the stored note', async () => {
    const ticket = await createTicket(requester.id);
    const noNote = await post(ticket.id, staffCookie, { description: 'x', followUpRequired: true });
    expect(noNote.status).toBe(400);
    const noFlag = await post(ticket.id, staffCookie, { description: 'x', followUpNote: 'orphan' });
    expect(noFlag.status).toBe(400);
    const created = await post(ticket.id, staffCookie, { description: 'x', followUpRequired: true, followUpNote: 'later' });
    expect(created.status).toBe(201);
    const bad = await patch(ticket.id, created.body.id, staffCookie, { version: 1, followUpRequired: false, followUpNote: 'still' });
    expect(bad.status).toBe(400);
    const cleared = await patch(ticket.id, created.body.id, staffCookie, { version: 1, followUpRequired: false });
    expect(cleared.status).toBe(200);
    expect(cleared.body.followUpRequired).toBe(false);
    expect(cleared.body.followUpNote).toBeNull();
  });

  it('API-06: attachmentNotes 501 chars 400, text stored verbatim; no file routes for an Action', async () => {
    const ticket = await createTicket(requester.id);
    const long = await post(ticket.id, staffCookie, { description: 'x', attachmentNotes: 'a'.repeat(501) });
    expect(long.status).toBe(400);
    const text = '<b>See</b> screenshot vpn-error.png';
    const ok = await post(ticket.id, staffCookie, { description: 'x', attachmentNotes: text });
    expect(ok.status).toBe(201);
    expect(ok.body.attachmentNotes).toBe(text);
    for (const suffix of ['files', 'attachments']) {
      const res = await request(testServer.server)
        .post(`${base(ticket.id)}/${ok.body.id}/${suffix}`)
        .set('Cookie', staffCookie)
        .set('Content-Type', 'application/json')
        .send({});
      expect(res.status).toBe(404);
    }
  });

  it('API-07: inactive / Requester / nonexistent assignee each 409 INVALID_ASSIGNEE, one message, on create and update', async () => {
    const inactive = await mk('IT_STAFF', { isActive: false });
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id);
    const messages = new Set<string>();
    for (const assigneeId of [inactive.id, requester.id, 2_000_000_000, 2_147_483_648, 1e300, 0, -1]) {
      const c = await post(ticket.id, staffCookie, { description: 'x', assigneeId });
      expect(c.status).toBe(409);
      expect(c.body.error).toBe('INVALID_ASSIGNEE');
      messages.add(c.body.message);
      const u = await patch(ticket.id, row.id, staffCookie, { version: 1, assigneeId });
      expect(u.status).toBe(409);
      expect(u.body.error).toBe('INVALID_ASSIGNEE');
      messages.add(u.body.message);
    }
    expect(messages.size).toBe(1);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.version).toBe(1);
    expect(stored.assigneeId).toBeNull();
    const adminAssignee = await post(ticket.id, staffCookie, { description: 'x', assigneeId: admin.id });
    expect(adminAssignee.status).toBe(201);
  });

  it('API-12: CLOSED and CANCELLED Tickets 409 TICKET_CLOSED on create/update; RESOLVED accepts', async () => {
    for (const status of ['CLOSED', 'CANCELLED'] as const) {
      const ticket = await createTicket(requester.id, { status });
      const row = await createActionRow(ticket.id, staff.id);
      const c = await post(ticket.id, staffCookie, { description: 'x' });
      expect(c.status).toBe(409);
      expect(c.body.error).toBe('TICKET_CLOSED');
      const u = await patch(ticket.id, row.id, staffCookie, { version: 1, description: 'edit' });
      expect(u.status).toBe(409);
      expect(u.body.error).toBe('TICKET_CLOSED');
      expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
    }
    const resolved = await createTicket(requester.id, { status: 'RESOLVED' });
    const row = await createActionRow(resolved.id, staff.id);
    expect((await post(resolved.id, staffCookie, { description: 'follow-up' })).status).toBe(201);
    expect((await patch(resolved.id, row.id, staffCookie, { version: 1, description: 'edit' })).status).toBe(200);
  });

  it('API-32: result optional until completion', async () => {
    const ticket = await createTicket(requester.id);
    const planned = await post(ticket.id, staffCookie, { description: 'x', status: 'PLANNED' });
    expect(planned.status).toBe(201);
    expect(planned.body.result).toBeNull();
    const done = await post(ticket.id, staffCookie, { description: 'x', status: 'COMPLETED' });
    expect(done.status).toBe(400);
    expect(done.body.fields.map((f: { field: string }) => f.field)).toContain('result');

    const inProgress = await createActionRow(ticket.id, staff.id, { status: 'IN_PROGRESS' });
    const no = await patch(ticket.id, inProgress.id, staffCookie, { version: 1, status: 'COMPLETED' });
    expect(no.status).toBe(400);
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: inProgress.id } })).status).toBe('IN_PROGRESS');
    const yes = await patch(ticket.id, inProgress.id, staffCookie, { version: 1, status: 'COMPLETED', result: 'Fixed' });
    expect(yes.status).toBe(200);

    const stored = await createActionRow(ticket.id, staff.id, { status: 'IN_PROGRESS', result: 'Partial result' });
    const keep = await patch(ticket.id, stored.id, staffCookie, { version: 1, status: 'COMPLETED' });
    expect(keep.status).toBe(200);
    expect(keep.body.result).toBe('Partial result');
  });

  it('API-13: same clientRequestId twice -> 201 then 200 with the same id, one row; no key -> two rows', async () => {
    const ticket = await createTicket(requester.id);
    const clientRequestId = randomUUID();
    const first = await post(ticket.id, staffCookie, { description: 'Once', clientRequestId });
    expect(first.status).toBe(201);
    const second = await post(ticket.id, staffCookie, { description: '  Once  ', clientRequestId });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body).not.toHaveProperty('clientRequestId');
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);

    await post(ticket.id, staffCookie, { description: 'No key' });
    await post(ticket.id, staffCookie, { description: 'No key' });
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(3);

    const bad = await post(ticket.id, staffCookie, { description: 'x', clientRequestId: 'not-a-uuid' });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.map((f: { field: string }) => f.field)).toContain('clientRequestId');
  });

  it('API-13: concurrent duplicates yield exactly one row (one 201, rest 200)', async () => {
    const ticket = await createTicket(requester.id);
    const clientRequestId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => post(ticket.id, staffCookie, { description: 'Race', clientRequestId })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it('API-13: concurrent same key, different bodies -> one 201, others 409 IDEMPOTENCY_CONFLICT', async () => {
    const ticket = await createTicket(requester.id);
    const clientRequestId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => post(ticket.id, staffCookie, { description: `Variant ${i}`, clientRequestId })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const others = results.filter((r) => r.status !== 201);
    expect(others).toHaveLength(5);
    for (const r of others) {
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it('API-33: same key with a different body -> 409 IDEMPOTENCY_CONFLICT, nothing changes; retry after edit still 200', async () => {
    const ticket = await createTicket(requester.id);
    const clientRequestId = randomUUID();
    const first = await post(ticket.id, staffCookie, { description: 'Original', clientRequestId });
    expect(first.status).toBe(201);
    for (const change of [{ description: 'Changed' }, { description: 'Original', status: 'IN_PROGRESS' }, { description: 'Original', assigneeId: staff2.id }]) {
      const res = await post(ticket.id, staffCookie, { ...change, clientRequestId });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(stored.description).toBe('Original');
    expect(stored.status).toBe('PLANNED');

    const edited = await patch(ticket.id, first.body.id, staffCookie, { version: 1, description: 'Edited later' });
    expect(edited.status).toBe(200);
    const retry = await post(ticket.id, staffCookie, { description: 'Original', clientRequestId });
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.description).toBe('Edited later');
  });

  it('same clientRequestId on a different Ticket is an independent create', async () => {
    const a = await createTicket(requester.id);
    const b = await createTicket(requester.id);
    const clientRequestId = randomUUID();
    expect((await post(a.id, staffCookie, { description: 'x', clientRequestId })).status).toBe(201);
    expect((await post(b.id, staffCookie, { description: 'x', clientRequestId })).status).toBe(201);
  });

  it('BR-34: invalid body 400 precedes the access lookup (Requester 403, unknown Ticket 404)', async () => {
    const ticket = await createTicket(requester.id);
    const asRequester = await post(ticket.id, requesterCookie, { description: '' });
    expect(asRequester.status).toBe(400);
    expect(asRequester.body.error).toBe('VALIDATION_FAILED');
    const unknownTicket = await post(999_999_999, staffCookie, { description: '' });
    expect(unknownTicket.status).toBe(400);
    const validAsRequester = await post(ticket.id, requesterCookie, { description: 'x' });
    expect(validAsRequester.status).toBe(403);
    const validUnknown = await post(999_999_999, staffCookie, { description: 'x' });
    expect(validUnknown.status).toBe(404);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it('BR-35: clientRequestId that is not a UUID v4 is 400, nothing written', async () => {
    const ticket = await createTicket(requester.id);
    for (const clientRequestId of ['6ba7b810-9dad-11d1-80b4-00c04fd430c8', '3f2b8c1e-5a4d-1e6f-9b7a-1c2d3e4f5a6b', 'x']) {
      const res = await post(ticket.id, staffCookie, { description: 'x', clientRequestId });
      expect(res.status, clientRequestId).toBe(400);
      expect(res.body.fields.map((f: { field: string }) => f.field)).toContain('clientRequestId');
    }
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it('BR-34: malformed JSON is a body-shape 400 after 401 and the path-id 404, before access', async () => {
    const ticket = await createTicket(requester.id);
    const raw = (url: string, cookie?: string) => {
      const r = request(testServer.server).post(url).set('Content-Type', 'application/json');
      return (cookie ? r.set('Cookie', cookie) : r).send('{"description": ');
    };
    expect((await raw(base(ticket.id))).status).toBe(401);
    expect((await raw('/api/tickets/abc/actions-taken', staffCookie)).status).toBe(404);
    const malformed = await raw(base(ticket.id), staffCookie);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe('MALFORMED_BODY');
    const asRequester = await raw(base(ticket.id), requesterCookie);
    expect(asRequester.status).toBe(400);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it('BR-34: a JSON Content-Type with no body is a 400 field-level answer, not 415; no Content-Type stays 415', async () => {
    const ticket = await createTicket(requester.id);
    const noBody = await request(testServer.server).post(base(ticket.id)).set('Cookie', staffCookie).set('Content-Type', 'application/json');
    expect(noBody.status).toBe(400);
    expect(noBody.body.error).toBe('VALIDATION_FAILED');
    expect(noBody.body.fields.map((f: { field: string }) => f.field)).toContain('description');
    const trulyBodiless = await rawBodiless('POST', base(ticket.id), staffCookie);
    expect(trulyBodiless.status).toBe(400);
    expect(JSON.parse(trulyBodiless.body).error).not.toBe('UNSUPPORTED_MEDIA_TYPE');
    const charset = await request(testServer.server).post(base(ticket.id)).set('Cookie', staffCookie).set('Content-Type', 'application/json; charset=utf-8');
    expect(charset.status).toBe(400);
    const none = await request(testServer.server).post(base(ticket.id)).set('Cookie', staffCookie);
    expect(none.status).toBe(415);
  });

  it('BR-04: impossible calendar dates are 400, real ones (leap day, offsets) are kept', async () => {
    const ticket = await createTicket(requester.id);
    for (const actionAt of ['2026-02-31T10:00:00Z', '2026-04-31T10:00:00+07:00', '2025-02-29T10:00:00Z', '2026-10-12T24:00:00Z']) {
      const res = await post(ticket.id, staffCookie, { description: 'x', status: 'PLANNED', actionAt });
      expect(res.status, actionAt).toBe(400);
      expect(res.body.fields.map((f: { field: string }) => f.field)).toContain('actionAt');
    }
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
    const leap = await post(ticket.id, staffCookie, { description: 'x', status: 'PLANNED', actionAt: '2096-02-29T10:00:00+07:00' });
    expect(leap.status).toBe(201);
    expect(new Date(leap.body.actionAt).toISOString()).toBe('2096-02-29T03:00:00.000Z');
  });

  it('BR-35: the same clientRequestId in another letter case is the same key', async () => {
    const ticket = await createTicket(requester.id);
    const id = randomUUID();
    const first = await post(ticket.id, staffCookie, { description: 'Case', clientRequestId: id });
    const second = await post(ticket.id, staffCookie, { description: 'Case', clientRequestId: id.toUpperCase() });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const other = await post(ticket.id, staffCookie, { description: 'Different', clientRequestId: id.toUpperCase() });
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('IDEMPOTENCY_CONFLICT');
    const rows = await prisma.actionTaken.findMany({ where: { ticketId: ticket.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].clientRequestId).toBe(id);
  });

  it('BR-35: same clientRequestId with attachmentNotes that differ only in trailing whitespace is a conflict, as sent', async () => {
    const ticket = await createTicket(requester.id);
    const key = randomUUID();
    const body = (attachmentNotes: string) => JSON.stringify({ description: 'Check the relay', clientRequestId: key, attachmentNotes });
    const a = await post(ticket.id, staffCookie, body('see vpn-error.png '));
    const b = await post(ticket.id, staffCookie, body('see vpn-error.png'));
    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('413 PAYLOAD_TOO_LARGE for an oversized JSON body once authenticated; 401 first without a session', async () => {
    const ticket = await createTicket(requester.id);
    const big = JSON.stringify({ description: 'x', attachmentNotes: 'a'.repeat(200_000) });
    const authed = await post(ticket.id, staffCookie, big);
    expect(authed.status).toBe(413);
    expect(authed.body.error).toBe('PAYLOAD_TOO_LARGE');
    const anon = await request(testServer.server).post(base(ticket.id)).set('Content-Type', 'application/json').send(big);
    expect(anon.status).toBe(401);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it('BR-07: attachmentNotes keeps its text as sent; blank is none; the limit counts the sent text', async () => {
    const ticket = await createTicket(requester.id);
    const padded = '  See vpn-error.png  \n';
    const kept = await post(ticket.id, staffCookie, { description: 'x', attachmentNotes: padded });
    expect(kept.status).toBe(201);
    expect(kept.body.attachmentNotes).toBe(padded);
    const blank = await post(ticket.id, staffCookie, { description: 'x', attachmentNotes: '   ' });
    expect(blank.status).toBe(201);
    expect(blank.body.attachmentNotes).toBeNull();
    const over = await post(ticket.id, staffCookie, { description: 'x', attachmentNotes: `${'a'.repeat(500)} ` });
    expect(over.status).toBe(400);
    const patched = await patch(ticket.id, kept.body.id, staffCookie, { version: 1, attachmentNotes: ' new note ' });
    expect(patched.status).toBe(200);
    expect(patched.body.attachmentNotes).toBe(' new note ');
  });

  it('404 for a nonexistent or non-integer Ticket id; 400 MALFORMED_BODY for a non-object body', async () => {
    expect((await post(99999999, staffCookie, { description: 'x' })).status).toBe(404);
    const bad = await request(testServer.server).post('/api/tickets/abc/actions-taken').set('Cookie', staffCookie).set('Content-Type', 'application/json').send({ description: 'x' });
    expect(bad.status).toBe(404);
    const ticket = await createTicket(requester.id);
    const arr = await post(ticket.id, staffCookie, [1]);
    expect(arr.status).toBe(400);
    expect(arr.body.error).toBe('MALFORMED_BODY');
  });

  it('415 for a non-JSON content type, nothing written', async () => {
    const ticket = await createTicket(requester.id);
    const res = await request(testServer.server).post(base(ticket.id)).set('Cookie', staffCookie).set('Content-Type', 'text/plain').send('description=x');
    expect(res.status).toBe(415);
    expect(await prisma.actionTaken.count()).toBe(0);
  });
});

describe('PATCH /api/tickets/:id/actions-taken/:actionId', () => {
  it('API-02: second editor keeps performedBy, sets lastUpdatedBy; client server-owned fields ignored', async () => {
    const ticket = await createTicket(requester.id);
    const created = await post(ticket.id, staffCookie, { description: 'x' });
    const res = await patch(ticket.id, created.body.id, staff2Cookie, {
      version: 1,
      description: 'edited',
      performedBy: { id: staff2.id },
      performedById: staff2.id,
      lastUpdatedById: staff.id,
      createdAt: '2000-01-01T00:00:00Z',
      ticketId: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.performedBy.id).toBe(staff.id);
    expect(res.body.lastUpdatedBy).toEqual({ id: staff2.id, name: staff2.name });
    expect(res.body.version).toBe(2);
    expect(res.body.createdAt).toBe(created.body.createdAt);
    expect(res.body.ticketId).toBe(ticket.id);
  });

  it('PATCH bumps Action version, touches Ticket updatedAt, leaves Ticket version', async () => {
    const ticket = await createTicket(requester.id);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date('2026-01-01T00:00:00Z') } });
    const row = await createActionRow(ticket.id, staff.id);
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const res = await patch(ticket.id, row.id, staffCookie, { version: 1, description: 'new' });
    expect(res.status).toBe(200);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.version).toBe(before.version);
  });

  it('API-08: permitted transitions 200; PLANNED->COMPLETED, terminal->anything and no-op 409 INVALID_ACTION_TRANSITION', async () => {
    const ticket = await createTicket(requester.id);
    const ok: Array<['PLANNED' | 'IN_PROGRESS', 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED']> = [
      ['PLANNED', 'IN_PROGRESS'],
      ['IN_PROGRESS', 'COMPLETED'],
      ['PLANNED', 'CANCELLED'],
      ['IN_PROGRESS', 'CANCELLED'],
    ];
    for (const [from, to] of ok) {
      const row = await createActionRow(ticket.id, staff.id, { status: from, result: 'r' });
      const res = await patch(ticket.id, row.id, staffCookie, { version: 1, status: to });
      expect(res.status, `${from}->${to}`).toBe(200);
      expect(res.body.status).toBe(to);
    }
    const planned = await createActionRow(ticket.id, staff.id, { status: 'PLANNED', result: 'r' });
    const skip = await patch(ticket.id, planned.id, staffCookie, { version: 1, status: 'COMPLETED' });
    expect(skip.status).toBe(409);
    expect(skip.body.error).toBe('INVALID_ACTION_TRANSITION');
    const noop = await patch(ticket.id, planned.id, staffCookie, { version: 1, status: 'PLANNED' });
    expect(noop.status).toBe(409);
    expect(noop.body.error).toBe('INVALID_ACTION_TRANSITION');
    const inProg = await createActionRow(ticket.id, staff.id, { status: 'IN_PROGRESS' });
    const back = await patch(ticket.id, inProg.id, staffCookie, { version: 1, status: 'PLANNED' });
    expect(back.body.error).toBe('INVALID_ACTION_TRANSITION');
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: planned.id } })).version).toBe(1);
  });

  it('API-09: PATCH of COMPLETED/CANCELLED 409 ACTION_LOCKED; DELETE 404', async () => {
    const ticket = await createTicket(requester.id);
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      const row = await createActionRow(ticket.id, staff.id, { status });
      const res = await patch(ticket.id, row.id, staffCookie, { version: 1, description: 'edit' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ACTION_LOCKED');
      const res2 = await patch(ticket.id, row.id, staffCookie, { version: 1, status: 'IN_PROGRESS' });
      expect(res2.body.error).toBe('ACTION_LOCKED');
    }
    const row = await createActionRow(ticket.id, staff.id);
    const del = await request(testServer.server).delete(`${base(ticket.id)}/${row.id}`).set('Cookie', staffCookie);
    expect(del.status).toBe(404);
    expect(await prisma.actionTaken.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it('API-14: stale version -> 409 STALE_UPDATE with current; first writer intact', async () => {
    const ticket = await createTicket(requester.id);
    const created = await post(ticket.id, staffCookie, { description: 'v1' });
    const first = await patch(ticket.id, created.body.id, staffCookie, { version: 1, description: 'first writer' });
    expect(first.status).toBe(200);
    const second = await patch(ticket.id, created.body.id, staff2Cookie, { version: 1, description: 'second writer' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('STALE_UPDATE');
    expect(second.body.current).toEqual(first.body);
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.description).toBe('first writer');
    expect(stored.version).toBe(2);
  });

  it('BR-34: body shape 400 precedes STALE_UPDATE; record-dependent 400 precedes it too; valid stale still 409', async () => {
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id);
    const badShapes: Record<string, unknown>[] = [
      { version: 7, description: '' },
      { version: 7, status: 'DONE' },
      { version: 7, assigneeId: 'x' },
      { version: 7, attachmentNotes: 'a'.repeat(501) },
      { version: 7, actionAt: 'not-a-date' },
    ];
    for (const body of badShapes) {
      const res = await patch(ticket.id, row.id, staffCookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');
    }
    const beforeCreation = await patch(ticket.id, row.id, staffCookie, {
      version: 7,
      actionAt: new Date(ticket.createdAt.getTime() - 86_400_000).toISOString(),
    });
    expect(beforeCreation.status).toBe(400);
    expect(beforeCreation.body.fields.map((f: { field: string }) => f.field)).toContain('actionAt');
    const noResult = await patch(ticket.id, row.id, staffCookie, { version: 7, status: 'COMPLETED' });
    expect(noResult.status).toBe(400);
    const stale = await patch(ticket.id, row.id, staffCookie, { version: 7, description: 'fine' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('STALE_UPDATE');
  });

  it('BR-34: PATCH body shape 400 precedes the access lookup (Requester 403, unknown Ticket 404)', async () => {
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id);
    const asRequester = await patch(ticket.id, row.id, requesterCookie, { version: 1, description: '' });
    expect(asRequester.status).toBe(400);
    const unknownTicket = await patch(999_999_999, row.id, staffCookie, { version: 1, description: '' });
    expect(unknownTicket.status).toBe(400);
    const validAsRequester = await patch(ticket.id, row.id, requesterCookie, { version: 1, description: 'x' });
    expect(validAsRequester.status).toBe(403);
  });

  it('API-14: stale check precedes domain conflicts (locked Action with old version -> STALE_UPDATE)', async () => {
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    const res = await patch(ticket.id, row.id, staffCookie, { version: 7, description: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STALE_UPDATE');
  });

  it('API-14: parallel PATCHes with the same version - exactly one wins', async () => {
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => patch(ticket.id, row.id, i % 2 ? staffCookie : staff2Cookie, { version: 1, description: `w${i}` })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.error === 'STALE_UPDATE')).toHaveLength(5);
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(2);
  });

  it('400 VALIDATION_FAILED on missing / invalid version, empty change set; nothing partially written', async () => {
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id);
    for (const version of [undefined, 0, -1, 1.5, '1']) {
      const res = await patch(ticket.id, row.id, staffCookie, { description: 'x', ...(version === undefined ? {} : { version }) });
      expect(res.status).toBe(400);
      expect(res.body.fields.map((f: { field: string }) => f.field)).toContain('version');
    }
    const empty = await patch(ticket.id, row.id, staffCookie, { version: 1 });
    expect(empty.status).toBe(400);
    const partial = await patch(ticket.id, row.id, staffCookie, { version: 1, description: 'changed', attachmentNotes: 'a'.repeat(501) });
    expect(partial.status).toBe(400);
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.description).toBe('Seeded action');
    expect(stored.version).toBe(1);
  });

  it('BR-34: PATCH malformed JSON / bodiless JSON request order matches POST', async () => {
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id);
    const raw = (url: string, cookie?: string) => {
      const r = request(testServer.server).patch(url).set('Content-Type', 'application/json');
      return (cookie ? r.set('Cookie', cookie) : r).send('{"version": ');
    };
    expect((await raw(`${base(ticket.id)}/${row.id}`)).status).toBe(401);
    expect((await raw(`${base(ticket.id)}/abc`, staffCookie)).status).toBe(404);
    const malformed = await raw(`${base(ticket.id)}/${row.id}`, staffCookie);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe('MALFORMED_BODY');
    const noBody = await request(testServer.server).patch(`${base(ticket.id)}/${row.id}`).set('Cookie', staffCookie).set('Content-Type', 'application/json');
    expect(noBody.status).toBe(400);
    expect(noBody.body.error).toBe('VALIDATION_FAILED');
    expect(noBody.body.fields.map((f: { field: string }) => f.field)).toContain('version');
    const trulyBodiless = await rawBodiless('PATCH', `${base(ticket.id)}/${row.id}`, staffCookie);
    expect(trulyBodiless.status).toBe(400);
    const bad = await patch(ticket.id, row.id, staffCookie, { version: 1, actionAt: '2026-02-31T10:00:00Z' });
    expect(bad.status).toBe(400);
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(1);
  });

  it('404 when the Action is on another Ticket, does not exist, or ids are not integers', async () => {
    const a = await createTicket(requester.id);
    const b = await createTicket(requester.id);
    const row = await createActionRow(a.id, staff.id);
    expect((await patch(b.id, row.id, staffCookie, { version: 1, description: 'x' })).status).toBe(404);
    expect((await patch(a.id, 99999999, staffCookie, { version: 1, description: 'x' })).status).toBe(404);
    expect((await patch(a.id, 'abc', staffCookie, { version: 1, description: 'x' })).status).toBe(404);
    expect((await patch(99999999, row.id, staffCookie, { version: 1, description: 'x' })).status).toBe(404);
  });

  it('415 for a non-JSON content type', async () => {
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id);
    const res = await request(testServer.server).patch(`${base(ticket.id)}/${row.id}`).set('Cookie', staffCookie).set('Content-Type', 'text/plain').send('x');
    expect(res.status).toBe(415);
  });

  it('unrelated PATCH is not blocked by a stored assignee that has since become inactive', async () => {
    const assignee = await mk('IT_STAFF');
    const ticket = await createTicket(requester.id);
    const row = await createActionRow(ticket.id, staff.id, { assigneeId: assignee.id });
    await prisma.user.update({ where: { id: assignee.id }, data: { isActive: false } });
    const res = await patch(ticket.id, row.id, staffCookie, { version: 1, description: 'edit' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/tickets/:id/actions-taken', () => {
  it('API-10: several staff on one Ticket; non-owner creates and edits; no Owner needed', async () => {
    const ticket = await createTicket(requester.id, { ownerId: staff.id });
    const c1 = await post(ticket.id, staff2Cookie, { description: 'by B' });
    const c2 = await post(ticket.id, adminCookie, { description: 'by admin' });
    expect(c1.status).toBe(201);
    expect(c2.status).toBe(201);
    expect((await patch(ticket.id, c2.body.id, staff2Cookie, { version: 1, description: 'B edits admin' })).status).toBe(200);
    const res = await list(ticket.id, staffCookie);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { performedBy: { id: number } }) => a.performedBy.id)).toEqual([staff2.id, admin.id]);
    const unowned = await createTicket(requester.id, { ownerId: null });
    expect((await post(unowned.id, staff2Cookie, { description: 'no owner' })).status).toBe(201);
  });

  it('API-11: ordered actionAt asc then id asc, stable across calls and after an edit', async () => {
    const ticket = await createTicket(requester.id);
    const t = (m: number) => new Date(Date.now() - m * 60_000);
    const a = await createActionRow(ticket.id, staff.id, { actionAt: t(10), description: 'a' });
    const b = await createActionRow(ticket.id, staff.id, { actionAt: t(30), description: 'b' });
    const same = t(20);
    const c = await createActionRow(ticket.id, staff.id, { actionAt: same, description: 'c' });
    const d = await createActionRow(ticket.id, staff.id, { actionAt: same, description: 'd' });
    const expected = [b.id, c.id, d.id, a.id];
    const r1 = await list(ticket.id, staffCookie);
    const r2 = await list(ticket.id, staffCookie);
    expect(r1.body.map((x: { id: number }) => x.id)).toEqual(expected);
    expect(r2.body).toEqual(r1.body);
    await patch(ticket.id, c.id, staffCookie, { version: 1, description: 'c edited' });
    const r3 = await list(ticket.id, adminCookie);
    expect(r3.body.map((x: { id: number }) => x.id)).toEqual(expected);
  });

  it('empty array when there are no Actions', async () => {
    const ticket = await createTicket(requester.id);
    const res = await list(ticket.id, staffCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('API-15: the owning Requester reads every field of their own Actions', async () => {
    const ticket = await createTicket(requester.id);
    const created = await post(ticket.id, staffCookie, {
      description: 'd',
      result: 'r',
      status: 'COMPLETED',
      followUpRequired: true,
      followUpNote: 'note',
      attachmentNotes: 'att',
      assigneeId: staff2.id,
    });
    const res = await list(ticket.id, requesterCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([created.body]);
    expect(res.body[0]).toMatchObject({ followUpNote: 'note', attachmentNotes: 'att', result: 'r' });
  });

  it('404 for nonexistent / non-integer id; another Requester gets the identical 404', async () => {
    const other = await mk('REQUESTER');
    const otherCookie = await loginCookie(testServer.server, other.email);
    const ticket = await createTicket(requester.id);
    const missing = await list(99999999, otherCookie);
    const foreign = await list(ticket.id, otherCookie);
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(missing.text);
    expect((await list('abc' as unknown as number, staffCookie)).status).toBe(404);
  });

  it('401 without a session', async () => {
    const ticket = await createTicket(requester.id);
    expect((await request(testServer.server).get(base(ticket.id))).status).toBe(401);
  });
});
