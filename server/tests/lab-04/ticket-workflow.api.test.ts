import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { setTransactionHook } from '../../src/lib/testHooks.js';
import { useTestServer } from '../setup/http-server.js';
import type { TicketStatus } from '../../src/generated/prisma/client.js';
import { createActionRow, createTicket, createUser, deleteUsers, loginCookie } from './helpers.js';

// Issue #95 phases A and B: PATCH /api/tickets/:id/status and GET /api/tickets/:id
// version (docs/lab-04/api-spec.md §1.3, §3.1, §3.2; specification.md BR-16..BR-19,
// BR-33, BR-34, BR-39..BR-41). tests.md rows WF-01..WF-08, WF-13..WF-16 and the
// status-route parts of WF-10..WF-12.

const testServer = useTestServer(app);

type User = Awaited<ReturnType<typeof createUser>>;

let userIds: number[] = [];
let requester: User;
let requester2: User;
let staff: User;
let admin: User;
let staffCookie: string;
let adminCookie: string;
let requesterCookie: string;
let requester2Cookie: string;

async function mk(role: 'REQUESTER' | 'IT_STAFF' | 'ADMINISTRATOR') {
  const u = await createUser(role);
  userIds.push(u.id);
  return u;
}

beforeEach(async () => {
  requester = await mk('REQUESTER');
  requester2 = await mk('REQUESTER');
  staff = await mk('IT_STAFF');
  admin = await mk('ADMINISTRATOR');
  staffCookie = await loginCookie(testServer.server, staff.email);
  adminCookie = await loginCookie(testServer.server, admin.email);
  requesterCookie = await loginCookie(testServer.server, requester.email);
  requester2Cookie = await loginCookie(testServer.server, requester2.email);
});

afterEach(async () => {
  setTransactionHook(null);
  await prisma.ticket.deleteMany({});
  await deleteUsers(userIds);
  userIds = [];
});

function patchStatus(ticketId: number | string, cookie: string | null, body: unknown) {
  const req = request(testServer.server).patch(`/api/tickets/${ticketId}/status`).set('Content-Type', 'application/json');
  return (cookie === null ? req : req.set('Cookie', cookie)).send(body as object);
}

const getTicket = (id: number) => prisma.ticket.findUniqueOrThrow({ where: { id } });
const historyOf = (ticketId: number) =>
  prisma.ticketStatusChange.findMany({ where: { ticketId }, orderBy: { id: 'asc' } });

/** Ticket with an Owner (staff) unless told otherwise. */
const owned = (status: TicketStatus, ownerId: number | null = staff.id) =>
  createTicket(requester.id, { status, ownerId });

const ALL: TicketStatus[] = [
  'NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_REQUESTER', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED',
];

// specification.md §5.1, independent of the module under test.
const PERMITTED: Array<[TicketStatus, TicketStatus]> = [
  ['NEW', 'OPEN'], ['NEW', 'IN_PROGRESS'], ['NEW', 'CANCELLED'],
  ['OPEN', 'IN_PROGRESS'], ['OPEN', 'WAITING_FOR_REQUESTER'], ['OPEN', 'RESOLVED'], ['OPEN', 'CANCELLED'],
  ['IN_PROGRESS', 'WAITING_FOR_REQUESTER'], ['IN_PROGRESS', 'RESOLVED'], ['IN_PROGRESS', 'CANCELLED'],
  ['WAITING_FOR_REQUESTER', 'IN_PROGRESS'], ['WAITING_FOR_REQUESTER', 'RESOLVED'], ['WAITING_FOR_REQUESTER', 'CANCELLED'],
  ['RESOLVED', 'CLOSED'], ['RESOLVED', 'REOPENED'], ['CLOSED', 'REOPENED'],
  ['REOPENED', 'IN_PROGRESS'], ['REOPENED', 'WAITING_FOR_REQUESTER'], ['REOPENED', 'RESOLVED'], ['REOPENED', 'CANCELLED'],
];
const permittedSet = new Set(PERMITTED.map(([f, t]) => `${f}->${t}`));
const FORBIDDEN: Array<[TicketStatus, TicketStatus]> = ALL.flatMap((f) =>
  ALL.filter((t) => !permittedSet.has(`${f}->${t}`)).map((t): [TicketStatus, TicketStatus] => [f, t]),
);

describe('GET /api/tickets/:id carries version (api-spec §3.1)', () => {
  it('returns version for staff and for the owning Requester', async () => {
    const ticket = await owned('OPEN');
    const asStaff = await request(testServer.server).get(`/api/tickets/${ticket.id}`).set('Cookie', staffCookie);
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.version).toBe(1);
    const asRequester = await request(testServer.server).get(`/api/tickets/${ticket.id}`).set('Cookie', requesterCookie);
    expect(asRequester.status).toBe(200);
    expect(asRequester.body.version).toBe(1);
    expect(asRequester.body).not.toHaveProperty('itPriority');
  });
});

describe('WF-01: every permitted transition succeeds', () => {
  it.each(PERMITTED)('%s -> %s', async (from, to) => {
    const ticket = await owned(from);
    if (to === 'RESOLVED') await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });

    const res = await patchStatus(ticket.id, staffCookie, { status: to, version: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ticket.id, status: to, version: 2 });
    expect(res.body.owner).toMatchObject({ id: staff.id });
    const stored = await getTicket(ticket.id);
    expect(stored.status).toBe(to);
    expect(stored.version).toBe(2);
  });
});

describe('WF-02: forbidden transitions and the owner rule', () => {
  it.each(FORBIDDEN)('%s -> %s is 409 INVALID_TRANSITION', async (from, to) => {
    const ticket = await owned(from);
    const res = await patchStatus(ticket.id, staffCookie, { status: to, version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_TRANSITION');
    const stored = await getTicket(ticket.id);
    expect(stored).toMatchObject({ status: from, version: 1 });
    expect(await historyOf(ticket.id)).toHaveLength(0);
  });

  it.each<TicketStatus>(['NEW', 'OPEN', 'WAITING_FOR_REQUESTER', 'REOPENED'])(
    '%s -> IN_PROGRESS without an owner is 409 OWNER_REQUIRED',
    async (from) => {
      const ticket = await owned(from, null);
      const res = await patchStatus(ticket.id, staffCookie, { status: 'IN_PROGRESS', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('OWNER_REQUIRED');
      expect(await getTicket(ticket.id)).toMatchObject({ status: from, version: 1 });
    },
  );
});

describe('WF-02b: role x current status x target status', () => {
  const PAIRS: Array<[TicketStatus, TicketStatus]> = ALL.flatMap((from) =>
    ALL.map((to): [TicketStatus, TicketStatus] => [from, to]),
  );

  // Refused roles never reach the gate or the transition check, so no gate setup is needed.
  async function refusedAndUnchanged(from: TicketStatus, to: TicketStatus, cookie: string | null) {
    const ticket = await owned(from);
    const res = await patchStatus(ticket.id, cookie, { status: to, version: 1 });
    expect(await getTicket(ticket.id)).toMatchObject({ status: from, version: 1 });
    expect(await historyOf(ticket.id)).toHaveLength(0);
    return res;
  }

  it.each(PAIRS)('Administrator %s -> %s is 403', async (from, to) => {
    expect((await refusedAndUnchanged(from, to, adminCookie)).status).toBe(403);
  });

  it.each(PAIRS)('owning Requester %s -> %s is 404', async (from, to) => {
    expect((await refusedAndUnchanged(from, to, requesterCookie)).status).toBe(404);
  });

  it.each(PAIRS)('other Requester %s -> %s is 404', async (from, to) => {
    expect((await refusedAndUnchanged(from, to, requester2Cookie)).status).toBe(404);
  });

  it.each(PAIRS)('unauthenticated %s -> %s is 401', async (from, to) => {
    expect((await refusedAndUnchanged(from, to, null)).status).toBe(401);
  });
});

describe('WF-03..WF-06: the resolution gate', () => {
  const codes = (body: { reasons: { code: string }[] }) => body.reasons.map((r) => r.code);

  async function expectBlocked(ticketId: number, from: TicketStatus) {
    const res = await patchStatus(ticketId, staffCookie, { status: 'RESOLVED', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RESOLUTION_BLOCKED');
    expect(await getTicket(ticketId)).toMatchObject({ status: from, version: 1 });
    expect(await historyOf(ticketId)).toHaveLength(0);
    return res;
  }

  it('WF-03: an Owner but no COMPLETED Action is blocked with NO_COMPLETED_ACTION', async () => {
    const ticket = await owned('IN_PROGRESS');
    const res = await expectBlocked(ticket.id, 'IN_PROGRESS');
    expect(codes(res.body)).toContain('NO_COMPLETED_ACTION');
    expect(codes(res.body)).toEqual(['NO_COMPLETED_ACTION']);
  });

  it.each<'PLANNED' | 'IN_PROGRESS'>(['PLANNED', 'IN_PROGRESS'])(
    'WF-04: a %s Action blocks with OPEN_ACTIONS_REMAIN and count; completing it unblocks',
    async (openStatus) => {
      const ticket = await owned('IN_PROGRESS');
      await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
      const open = await createActionRow(ticket.id, staff.id, { status: openStatus });
      const res = await expectBlocked(ticket.id, 'IN_PROGRESS');
      expect(res.body.reasons).toEqual([
        expect.objectContaining({ code: 'OPEN_ACTIONS_REMAIN', count: 1 }),
      ]);
      expect(res.body.message).toBe("This ticket can't be resolved yet.");

      await prisma.actionTaken.update({ where: { id: open.id }, data: { status: 'COMPLETED', result: 'Done' } });
      const ok = await patchStatus(ticket.id, staffCookie, { status: 'RESOLVED', version: 1 });
      expect(ok.status).toBe(200);
    },
  );

  it('WF-04: cancelling the open Action also unblocks', async () => {
    const ticket = await owned('IN_PROGRESS');
    await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    const open = await createActionRow(ticket.id, staff.id, { status: 'PLANNED' });
    await expectBlocked(ticket.id, 'IN_PROGRESS');
    await prisma.actionTaken.update({ where: { id: open.id }, data: { status: 'CANCELLED' } });
    expect((await patchStatus(ticket.id, staffCookie, { status: 'RESOLVED', version: 1 })).status).toBe(200);
  });

  it('WF-05: no Owner is blocked with OWNER_MISSING; Owner + COMPLETED + nothing open succeeds with a history row', async () => {
    const ticket = await owned('IN_PROGRESS', null);
    await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    const res = await expectBlocked(ticket.id, 'IN_PROGRESS');
    expect(codes(res.body)).toEqual(['OWNER_MISSING']);

    await prisma.ticket.update({ where: { id: ticket.id }, data: { ownerId: staff.id } });
    const ok = await patchStatus(ticket.id, staffCookie, { status: 'RESOLVED', version: 1 });
    expect(ok.status).toBe(200);
    const history = await historyOf(ticket.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'IN_PROGRESS', toStatus: 'RESOLVED', changedById: staff.id });
  });

  it('WF-06: all three failing returns all three reasons in order', async () => {
    const ticket = await owned('OPEN', null);
    await createActionRow(ticket.id, staff.id, { status: 'PLANNED' });
    await createActionRow(ticket.id, staff.id, { status: 'IN_PROGRESS' });
    const res = await expectBlocked(ticket.id, 'OPEN');
    expect(res.body.reasons).toEqual([
      { code: 'OWNER_MISSING', message: expect.any(String) },
      { code: 'NO_COMPLETED_ACTION', message: expect.any(String) },
      { code: 'OPEN_ACTIONS_REMAIN', message: expect.any(String), count: 2 },
    ]);
  });

  it('WF-06: CANCELLED-only Actions give NO_COMPLETED_ACTION but not OPEN_ACTIONS_REMAIN', async () => {
    const ticket = await owned('OPEN');
    await createActionRow(ticket.id, staff.id, { status: 'CANCELLED' });
    const res = await expectBlocked(ticket.id, 'OPEN');
    expect(codes(res.body)).toEqual(['NO_COMPLETED_ACTION']);
  });

  it('REOPENED -> RESOLVED counts every Action on the Ticket (D-17)', async () => {
    const ticket = await owned('REOPENED');
    await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    await createActionRow(ticket.id, staff.id, { status: 'PLANNED' });
    const res = await expectBlocked(ticket.id, 'REOPENED');
    expect(codes(res.body)).toEqual(['OPEN_ACTIONS_REMAIN']);
  });

  it('check order: INVALID_TRANSITION and OWNER_REQUIRED come before RESOLUTION_BLOCKED', async () => {
    const fromNew = await owned('NEW', null);
    const a = await patchStatus(fromNew.id, staffCookie, { status: 'RESOLVED', version: 1 });
    expect(a.body.error).toBe('INVALID_TRANSITION');
    const noOwner = await owned('OPEN', null);
    const b = await patchStatus(noOwner.id, staffCookie, { status: 'IN_PROGRESS', version: 1 });
    expect(b.body.error).toBe('OWNER_REQUIRED');
  });
});

describe('WF-07: the Requester advisory is not resolution (BR-18)', () => {
  it('requester-resolved changes no status and the gate still blocks', async () => {
    const ticket = await owned('IN_PROGRESS');
    const adv = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/requester-resolved`)
      .set('Cookie', requesterCookie)
      .set('Content-Type', 'application/json')
      .send({});
    expect(adv.status).toBe(204);
    expect(await getTicket(ticket.id)).toMatchObject({ status: 'IN_PROGRESS', version: 1 });

    const res = await patchStatus(ticket.id, staffCookie, { status: 'RESOLVED', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RESOLUTION_BLOCKED');
  });

  it.each<TicketStatus>(['RESOLVED', 'CLOSED'])('a Requester PATCH to %s is refused', async (to) => {
    const ticket = await owned('IN_PROGRESS');
    await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    const res = await patchStatus(ticket.id, requesterCookie, { status: to, version: 1 });
    expect(res.status).toBe(404); // Lab 3 behaviour retained: a Requester has no write path here
    expect(await getTicket(ticket.id)).toMatchObject({ status: 'IN_PROGRESS', version: 1 });
    expect(await historyOf(ticket.id)).toHaveLength(0);
  });
});

describe('WF-08: history is written transactionally (BR-19)', () => {
  it('writes one row per change with the right from, to and changedBy', async () => {
    const ticket = await owned('NEW');
    expect((await patchStatus(ticket.id, staffCookie, { status: 'OPEN', version: 1 })).status).toBe(200);
    expect((await patchStatus(ticket.id, staffCookie, { status: 'IN_PROGRESS', version: 2 })).status).toBe(200);
    const history = await historyOf(ticket.id);
    expect(history.map((h) => [h.fromStatus, h.toStatus, h.changedById])).toEqual([
      ['NEW', 'OPEN', staff.id],
      ['OPEN', 'IN_PROGRESS', staff.id],
    ]);
  });

  it('a failure after the Ticket update rolls the status, version and history back', async () => {
    const ticket = await owned('NEW');
    setTransactionHook((stage, scope) => {
      if (stage === 'before-commit' && scope === 'status') throw new Error('forced failure');
    });
    const res = await patchStatus(ticket.id, staffCookie, { status: 'OPEN', version: 1 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL');
    expect(await getTicket(ticket.id)).toMatchObject({ status: 'NEW', version: 1 });
    expect(await historyOf(ticket.id)).toHaveLength(0);
  });
});

describe('WF-10 (status route): stale writes', () => {
  it('an outdated version is 409 STALE_UPDATE with the current Ticket; nothing is written', async () => {
    const ticket = await owned('NEW');
    await prisma.ticket.update({ where: { id: ticket.id }, data: { version: 3, status: 'OPEN' } });
    const res = await patchStatus(ticket.id, staffCookie, { status: 'IN_PROGRESS', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STALE_UPDATE');
    expect(res.body.current).toMatchObject({ id: ticket.id, status: 'OPEN', version: 3 });
    expect(await getTicket(ticket.id)).toMatchObject({ status: 'OPEN', version: 3 });
    expect(await historyOf(ticket.id)).toHaveLength(0);
  });

  it('a version ahead of the stored one is also stale', async () => {
    const ticket = await owned('NEW');
    const res = await patchStatus(ticket.id, staffCookie, { status: 'OPEN', version: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STALE_UPDATE');
  });
});

describe('WF-11 (status route): missing or invalid version', () => {
  it.each([
    ['absent', {}],
    ['null', { version: null }],
    ['a string', { version: '1' }],
    ['a fraction', { version: 1.5 }],
    ['zero', { version: 0 }],
    ['negative', { version: -1 }],
  ])('version %s is 400 VALIDATION_FAILED on field version', async (_label, extra) => {
    const ticket = await owned('NEW');
    const res = await patchStatus(ticket.id, staffCookie, { status: 'OPEN', ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.map((f: { field: string }) => f.field)).toContain('version');
    expect(await getTicket(ticket.id)).toMatchObject({ status: 'NEW', version: 1 });
  });

  it('reports status and version errors together', async () => {
    const ticket = await owned('NEW');
    const res = await patchStatus(ticket.id, staffCookie, { status: 'FOO' });
    expect(res.status).toBe(400);
    expect(res.body.fields.map((f: { field: string }) => f.field).sort()).toEqual(['status', 'version']);
  });
});

describe('WF-12 (status route): concurrent writers', () => {
  it('two simultaneous PATCHes with the same version: one 200, one 409 STALE_UPDATE, version +1 once', async () => {
    const ticket = await owned('OPEN');
    const [a, b] = await Promise.all([
      patchStatus(ticket.id, staffCookie, { status: 'IN_PROGRESS', version: 1 }),
      patchStatus(ticket.id, staffCookie, { status: 'WAITING_FOR_REQUESTER', version: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toBe('STALE_UPDATE');
    expect(await getTicket(ticket.id)).toMatchObject({ version: 2 });
    expect(await historyOf(ticket.id)).toHaveLength(1);
  });
});

describe('WF-13: check order (BR-34)', () => {
  it('text/plain with no session is 415 before 401', async () => {
    const ticket = await owned('NEW');
    const res = await request(testServer.server)
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Content-Type', 'text/plain')
      .send('status=OPEN');
    expect(res.status).toBe(415);
  });

  it('no session with JSON is 401', async () => {
    const ticket = await owned('NEW');
    const res = await patchStatus(ticket.id, null, { status: 'OPEN', version: 1 });
    expect(res.status).toBe(401);
  });

  it('stale + invalid transition returns STALE_UPDATE first; fresh + invalid returns INVALID_TRANSITION', async () => {
    const ticket = await owned('NEW');
    const stale = await patchStatus(ticket.id, staffCookie, { status: 'CLOSED', version: 9 });
    expect(stale.body.error).toBe('STALE_UPDATE');
    const fresh = await patchStatus(ticket.id, staffCookie, { status: 'CLOSED', version: 1 });
    expect(fresh.body.error).toBe('INVALID_TRANSITION');
  });

  it("malformed body on another Requester's Ticket is 400 before 404", async () => {
    const ticket = await owned('NEW');
    const res = await patchStatus(ticket.id, requester2Cookie, { status: 'FOO' });
    expect(res.status).toBe(400);
    const ok = await patchStatus(ticket.id, requester2Cookie, { status: 'OPEN', version: 1 });
    expect(ok.status).toBe(404);
  });

  it('malformed path id is 404; unknown Ticket with a valid body is 404', async () => {
    expect((await patchStatus('abc', staffCookie, { status: 'OPEN', version: 1 })).status).toBe(404);
    expect((await patchStatus(999_999, staffCookie, { status: 'OPEN', version: 1 })).status).toBe(404);
  });

  it('an Administrator is 403 and writes nothing', async () => {
    const ticket = await owned('NEW');
    const res = await patchStatus(ticket.id, adminCookie, { status: 'OPEN', version: 1 });
    expect(res.status).toBe(403);
    expect(await getTicket(ticket.id)).toMatchObject({ status: 'NEW', version: 1 });
  });

  it('a non-object body is 400 MALFORMED_BODY', async () => {
    const ticket = await owned('NEW');
    const res = await patchStatus(ticket.id, staffCookie, [1]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MALFORMED_BODY');
  });
});

describe('WF-14: an Action write racing a Resolve (BR-39)', () => {
  /** Pauses the first transaction to take the lock until released; later ones pass straight through. */
  function pauseFirstAfterLock() {
    let reached!: () => void;
    let release!: () => void;
    const reachedP = new Promise<void>((r) => (reached = r));
    const releaseP = new Promise<void>((r) => (release = r));
    let first = true;
    setTransactionHook(async (stage) => {
      if (stage !== 'after-lock' || !first) return;
      first = false;
      reached();
      await releaseP;
    });
    const timeout = new Promise<void>((_, rej) =>
      setTimeout(() => rej(new Error('transaction never reached the after-lock hook')), 5000),
    );
    return { reached: Promise.race([reachedP, timeout]), release };
  }
  const settle = () => new Promise((r) => setTimeout(r, 300));

  it('Action commits first: the Resolve is 409 RESOLUTION_BLOCKED', async () => {
    const ticket = await owned('IN_PROGRESS');
    await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    const gate = pauseFirstAfterLock();

    const create = request(testServer.server)
      .post(`/api/tickets/${ticket.id}/actions-taken`)
      .set('Cookie', staffCookie)
      .set('Content-Type', 'application/json')
      .send({ description: 'Late work', status: 'PLANNED' })
      .then((r) => r);
    await gate.reached;
    const resolve = patchStatus(ticket.id, staffCookie, { status: 'RESOLVED', version: 1 }).then((r) => r);
    await settle();
    gate.release();
    const [created, resolved] = await Promise.all([create, resolve]);

    expect(created.status).toBe(201);
    expect(resolved.status).toBe(409);
    expect(resolved.body.error).toBe('RESOLUTION_BLOCKED');
    expect(resolved.body.reasons.map((r: { code: string }) => r.code)).toEqual(['OPEN_ACTIONS_REMAIN']);
    expect((await getTicket(ticket.id)).status).toBe('IN_PROGRESS');
  });

  it('Resolve commits first: the Action is created afterwards on a RESOLVED Ticket', async () => {
    const ticket = await owned('IN_PROGRESS');
    await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    const gate = pauseFirstAfterLock();

    const resolve = patchStatus(ticket.id, staffCookie, { status: 'RESOLVED', version: 1 }).then((r) => r);
    await gate.reached;
    const create = request(testServer.server)
      .post(`/api/tickets/${ticket.id}/actions-taken`)
      .set('Cookie', staffCookie)
      .set('Content-Type', 'application/json')
      .send({ description: 'Follow-up', status: 'PLANNED' })
      .then((r) => r);
    await settle();
    gate.release();
    const [resolved, created] = await Promise.all([resolve, create]);

    expect(resolved.status).toBe(200);
    expect(created.status).toBe(201);
    expect((await getTicket(ticket.id)).status).toBe('RESOLVED');
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id, status: 'PLANNED' } })).toBe(1);
  });
});

describe('WF-15: closing gate (BR-40)', () => {
  it.each<'PLANNED' | 'IN_PROGRESS'>(['PLANNED', 'IN_PROGRESS'])(
    'RESOLVED -> CLOSED with a %s Action is blocked with only OPEN_ACTIONS_REMAIN',
    async (openStatus) => {
      const ticket = await owned('RESOLVED');
      const open = await createActionRow(ticket.id, staff.id, { status: openStatus });
      const res = await patchStatus(ticket.id, staffCookie, { status: 'CLOSED', version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('RESOLUTION_BLOCKED');
      expect(res.body.message).toBe("This ticket can't be closed yet.");
      expect(res.body.reasons).toEqual([expect.objectContaining({ code: 'OPEN_ACTIONS_REMAIN', count: 1 })]);
      expect(await getTicket(ticket.id)).toMatchObject({ status: 'RESOLVED', version: 1 });
      expect(await historyOf(ticket.id)).toHaveLength(0);

      await prisma.actionTaken.update({ where: { id: open.id }, data: { status: 'CANCELLED' } });
      expect((await patchStatus(ticket.id, staffCookie, { status: 'CLOSED', version: 1 })).status).toBe(200);
    },
  );

  it('an Action logged on a RESOLVED Ticket then blocks Close', async () => {
    const ticket = await owned('IN_PROGRESS');
    await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    expect((await patchStatus(ticket.id, staffCookie, { status: 'RESOLVED', version: 1 })).status).toBe(200);
    const created = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/actions-taken`)
      .set('Cookie', staffCookie)
      .set('Content-Type', 'application/json')
      .send({ description: 'Late follow-up' });
    expect(created.status).toBe(201);
    const res = await patchStatus(ticket.id, staffCookie, { status: 'CLOSED', version: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RESOLUTION_BLOCKED');
  });

  it('RESOLVED -> REOPENED is not gated by open Actions', async () => {
    const ticket = await owned('RESOLVED');
    await createActionRow(ticket.id, staff.id, { status: 'PLANNED' });
    expect((await patchStatus(ticket.id, staffCookie, { status: 'REOPENED', version: 1 })).status).toBe(200);
  });
});

describe('WF-16: cancel cascade (BR-41)', () => {
  async function seedCancelCase() {
    const ticket = await owned('IN_PROGRESS');
    const planned = await createActionRow(ticket.id, requester.id === 0 ? staff.id : staff.id, { status: 'PLANNED' });
    const inProgress = await createActionRow(ticket.id, staff.id, { status: 'IN_PROGRESS' });
    const completed = await createActionRow(ticket.id, staff.id, { status: 'COMPLETED' });
    return { ticket, planned, inProgress, completed };
  }

  it('cancels non-terminal Actions with lastUpdatedBy = canceller and version + 1; COMPLETED untouched; one history row', async () => {
    const { ticket, planned, inProgress, completed } = await seedCancelCase();
    const other = await mk('IT_STAFF');
    await prisma.actionTaken.update({ where: { id: planned.id }, data: { lastUpdatedById: other.id } });

    const res = await patchStatus(ticket.id, staffCookie, { status: 'CANCELLED', version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');

    const rows = await prisma.actionTaken.findMany({ where: { ticketId: ticket.id }, orderBy: { id: 'asc' } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of [planned.id, inProgress.id]) {
      expect(byId.get(id)).toMatchObject({ status: 'CANCELLED', lastUpdatedById: staff.id, version: 2 });
    }
    expect(byId.get(completed.id)).toMatchObject({ status: 'COMPLETED', lastUpdatedById: staff.id, version: 1 });
    expect(await historyOf(ticket.id)).toHaveLength(1);
  });

  it('a forced failure rolls the Ticket, the Actions and the history back together', async () => {
    const { ticket } = await seedCancelCase();
    setTransactionHook((stage, scope) => {
      if (stage === 'before-commit' && scope === 'status') throw new Error('forced failure');
    });
    const res = await patchStatus(ticket.id, staffCookie, { status: 'CANCELLED', version: 1 });
    expect(res.status).toBe(500);
    expect(await getTicket(ticket.id)).toMatchObject({ status: 'IN_PROGRESS', version: 1 });
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id, status: 'CANCELLED' } })).toBe(0);
    expect(await historyOf(ticket.id)).toHaveLength(0);
  });

  it('a non-cancel transition leaves open Actions alone', async () => {
    const { ticket } = await seedCancelCase();
    const res = await patchStatus(ticket.id, staffCookie, { status: 'WAITING_FOR_REQUESTER', version: 1 });
    expect(res.status).toBe(200);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id, status: 'CANCELLED' } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase B: owner and IT Priority guarded by version; status-history read.
// ---------------------------------------------------------------------------

function patchGuarded(route: 'owner' | 'it-priority', ticketId: number | string, cookie: string | null, body: unknown) {
  const req = request(testServer.server).patch(`/api/tickets/${ticketId}/${route}`).set('Content-Type', 'application/json');
  return (cookie === null ? req : req.set('Cookie', cookie)).send(body as object);
}

const ROUTES = [
  ['owner', (v: unknown) => ({ ownerId: staff.id, ...(v === undefined ? {} : { version: v }) })],
  ['it-priority', (v: unknown) => ({ itPriority: 'HIGH', ...(v === undefined ? {} : { version: v }) })],
] as const;

describe.each(ROUTES)('WF-10..12 (%s route): version guard', (route, bodyWith) => {
  it('a current version succeeds, returns the incremented version and stores it', async () => {
    const ticket = await owned('OPEN', null);
    const res = await patchGuarded(route, ticket.id, staffCookie, bodyWith(1));
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect((await getTicket(ticket.id)).version).toBe(2);
    // The next write must send the new version.
    const again = await patchGuarded(route, ticket.id, staffCookie, bodyWith(2));
    expect(again.status).toBe(200);
    expect(again.body.version).toBe(3);
  });

  it('WF-10: an outdated version is 409 STALE_UPDATE with the current Ticket; nothing is written', async () => {
    const ticket = await owned('OPEN', null);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { version: 3 } });
    const res = await patchGuarded(route, ticket.id, staffCookie, bodyWith(1));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STALE_UPDATE');
    expect(res.body.current).toMatchObject({ id: ticket.id, version: 3, owner: null, itPriority: 'MEDIUM' });
    expect(await getTicket(ticket.id)).toMatchObject({ version: 3, ownerId: null, itPriority: 'MEDIUM' });
  });

  it('WF-10: a stale version beats INVALID_OWNER (business conflicts come after STALE_UPDATE)', async () => {
    if (route !== 'owner') return;
    const ticket = await owned('OPEN', null);
    const res = await patchGuarded(route, ticket.id, staffCookie, { ownerId: requester.id, version: 9 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STALE_UPDATE');
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['a string', '1'],
    ['a fraction', 1.5],
    ['zero', 0],
    ['negative', -1],
  ])('WF-11: version %s is 400 VALIDATION_FAILED on field version', async (_label, v) => {
    const ticket = await owned('OPEN', null);
    const res = await patchGuarded(route, ticket.id, staffCookie, bodyWith(v));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.map((f: { field: string }) => f.field)).toContain('version');
    expect(await getTicket(ticket.id)).toMatchObject({ version: 1, ownerId: null, itPriority: 'MEDIUM' });
  });

  it('WF-11: a body error on the main field and a missing version are reported together', async () => {
    const ticket = await owned('OPEN', null);
    const bad = route === 'owner' ? { ownerId: 'x' } : { itPriority: 'URGENT' };
    const res = await patchGuarded(route, ticket.id, staffCookie, bad);
    expect(res.status).toBe(400);
    expect(res.body.fields.map((f: { field: string }) => f.field).sort()).toEqual(
      [route === 'owner' ? 'ownerId' : 'itPriority', 'version'].sort(),
    );
  });

  it('WF-11: shape 400 comes before the access 404', async () => {
    const ticket = await owned('OPEN', null);
    const res = await patchGuarded(route, ticket.id, requester2Cookie, bodyWith(undefined));
    expect(res.status).toBe(400);
  });

  it('WF-12: two simultaneous PATCHes with the same version: one 200, one 409 STALE_UPDATE, version +1 once', async () => {
    const ticket = await owned('OPEN', null);
    const [a, b] = await Promise.all([
      patchGuarded(route, ticket.id, staffCookie, bodyWith(1)),
      patchGuarded(route, ticket.id, staffCookie, bodyWith(1)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toBe('STALE_UPDATE');
    expect((await getTicket(ticket.id)).version).toBe(2);
  });

  it('a Requester is still 404 and an unknown Ticket 404', async () => {
    const ticket = await owned('OPEN', null);
    expect((await patchGuarded(route, ticket.id, requesterCookie, bodyWith(1))).status).toBe(404);
    expect((await patchGuarded(route, ticket.id + 100000, staffCookie, bodyWith(1))).status).toBe(404);
  });
});

describe('it-priority route: Administrator keeps write access with version', () => {
  it('an Administrator with the current version gets 200 and version + 1', async () => {
    const ticket = await owned('OPEN', null);
    const res = await patchGuarded('it-priority', ticket.id, adminCookie, { itPriority: 'LOW', version: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ itPriority: 'LOW', version: 2 });
  });
});

describe('WF-09: status history is append-only and scoped (BR-13, BR-14, BR-19)', () => {
  const getHistory = (ticketId: number | string, cookie: string | null) => {
    const req = request(testServer.server).get(`/api/tickets/${ticketId}/status-history`);
    return cookie === null ? req : req.set('Cookie', cookie);
  };

  it('is [] for a Ticket that never changed status', async () => {
    const ticket = await owned('OPEN');
    const res = await getHistory(ticket.id, requesterCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('the owning Requester, IT Staff and an Administrator read the rows in changedAt then id order with the documented shape', async () => {
    const ticket = await owned('NEW');
    const t = new Date('2026-10-01T08:00:00.000Z');
    // Insert out of id order relative to changedAt, plus a tie on changedAt.
    const late = await prisma.ticketStatusChange.create({
      data: { ticketId: ticket.id, fromStatus: 'OPEN', toStatus: 'IN_PROGRESS', changedById: staff.id, changedAt: new Date(t.getTime() + 60_000) },
    });
    const first = await prisma.ticketStatusChange.create({
      data: { ticketId: ticket.id, fromStatus: 'NEW', toStatus: 'OPEN', changedById: staff.id, changedAt: t },
    });
    const tie = await prisma.ticketStatusChange.create({
      data: { ticketId: ticket.id, fromStatus: 'IN_PROGRESS', toStatus: 'WAITING_FOR_REQUESTER', changedById: staff.id, changedAt: new Date(t.getTime() + 60_000) },
    });
    for (const cookie of [requesterCookie, staffCookie, adminCookie]) {
      const res = await getHistory(ticket.id, cookie);
      expect(res.status).toBe(200);
      expect(res.body.map((r: { id: number }) => r.id)).toEqual([first.id, late.id, tie.id]);
      expect(res.body[0]).toEqual({
        id: first.id,
        fromStatus: 'NEW',
        toStatus: 'OPEN',
        changedBy: { id: staff.id, name: staff.name, role: 'IT_STAFF' },
        changedAt: t.toISOString(),
      });
    }
  });

  it('reflects a real status change made through the API', async () => {
    const ticket = await owned('OPEN');
    await patchStatus(ticket.id, staffCookie, { status: 'IN_PROGRESS', version: 1 });
    const res = await getHistory(ticket.id, requesterCookie);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ fromStatus: 'OPEN', toStatus: 'IN_PROGRESS', changedBy: { id: staff.id } });
  });

  it("another Requester's Ticket is 404 identical to a nonexistent one", async () => {
    const ticket = await owned('OPEN');
    await prisma.ticketStatusChange.create({
      data: { ticketId: ticket.id, fromStatus: 'NEW', toStatus: 'OPEN', changedById: staff.id },
    });
    const other = await getHistory(ticket.id, requester2Cookie);
    const missing = await getHistory(ticket.id + 100000, requester2Cookie);
    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
    expect(other.status).toBe(missing.status);
  });

  it('no session is 401; a malformed or unknown id is 404 for staff', async () => {
    const ticket = await owned('OPEN');
    expect((await getHistory(ticket.id, null)).status).toBe(401);
    expect((await getHistory('abc', staffCookie)).status).toBe(404);
    expect((await getHistory(ticket.id + 100000, staffCookie)).status).toBe(404);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('%s on status-history is 404 for every role and writes nothing', async (method) => {
    const ticket = await owned('OPEN');
    const row = await prisma.ticketStatusChange.create({
      data: { ticketId: ticket.id, fromStatus: 'NEW', toStatus: 'OPEN', changedById: staff.id },
    });
    for (const path of [`/api/tickets/${ticket.id}/status-history`, `/api/tickets/${ticket.id}/status-history/${row.id}`]) {
      for (const cookie of [staffCookie, adminCookie, requesterCookie]) {
        const res = await request(testServer.server)[method](path).set('Cookie', cookie).set('Content-Type', 'application/json').send({ toStatus: 'CLOSED' });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
    expect(await historyOf(ticket.id)).toHaveLength(1);
    expect((await historyOf(ticket.id))[0]).toMatchObject({ id: row.id, toStatus: 'OPEN' });
  });
});
