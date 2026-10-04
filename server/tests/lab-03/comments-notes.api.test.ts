import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import { useTestServer } from '../setup/http-server.js';
import type { Role, TicketStatus } from '../../src/generated/prisma/client.js';

// Issue #70's half of this file — Public Comments (GET/POST
// /api/tickets/:id/comments) and "Problem Appears Resolved" (POST
// /api/tickets/:id/requester-resolved). Covers docs/lab-03/api-spec.md
// §3.1-3.3, specification.md FR-16..FR-18, BR-04, BR-05, BR-15..BR-18,
// BR-26, and tests.md's API-34..API-36, API-39, API-40.
//
// Internal Notes (GET/POST /api/tickets/:id/notes) are issue #72's half of
// this same file, per tests.md's own note: "creates the file, Public
// Comment half; #72 adds the Internal Notes half." Nothing below touches
// notes.
//
// -----------------------------------------------------------------------
// Honest scope note — SEC-05 (tests.md)
// -----------------------------------------------------------------------
// SEC-05 ("Internal Notes hidden: Requester -> 404 on notes, identical to
// a nonexistent ticket; no note content in the body") is entirely about
// the Internal Notes endpoint (GET /api/tickets/:id/notes), which does not
// exist on this branch — it is issue #72's route to build, exactly like
// authorization.api.test.ts's own SEC-05 entry already defers it. There is
// no "Requester-side-only half" of SEC-05 that can be honestly separated
// from the Internal-Notes route itself: the row's whole premise is a route
// this issue does not build. So SEC-05 is not exercised here either —
// deferred to #72, same as authorization.api.test.ts already documents.
// The comparable Public-Comments case IS covered below (a Requester who
// does not own the ticket gets 404, byte-identical to an unknown ticket,
// on both GET and POST /comments) — see "ownership and existence" below.

const testServer = useTestServer(app);

let createdUserIds: number[] = [];
let createdTicketIds: number[] = [];

afterEach(async () => {
  if (createdTicketIds.length > 0) {
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
    createdTicketIds = [];
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds = [];
  }
});

const DEFAULT_PASSWORD = 'CorrectHorseBattery1';

async function createUser(role: Role, options: { emailPrefix?: string } = {}) {
  const { emailPrefix = role.toLowerCase() } = options;
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const email = `comments-test-${emailPrefix}-${Math.random().toString(36).slice(2)}-${Date.now()}@example.edu`;

  const user = await prisma.user.create({
    data: { name: `Comments Test ${role}`, email, role, isActive: true, mustChangePassword: false, passwordHash },
  });
  createdUserIds.push(user.id);
  return user;
}

async function loginAndGetCookie(email: string): Promise<string> {
  const res = await request(testServer.server)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password: DEFAULT_PASSWORD });
  expect(res.status, 'test fixture login must succeed').toBe(200);
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  const raw = setCookie.find((c) => c.startsWith('toktickit.sid='));
  if (!raw) throw new Error('Response carried no session cookie');
  return raw.split(';')[0];
}

async function createTicket(requesterId: number, overrides: { status?: TicketStatus } = {}) {
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const ticketNumber = `TKT-COMMENTS-${Math.random().toString(36).slice(2)}`;

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber,
      requesterId,
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary: 'A ticket used to exercise Public Comments',
      description: 'Description text long enough to satisfy the 20-character minimum for this field.',
      requestedPriority: 'MEDIUM',
      itPriority: 'MEDIUM',
      status: overrides.status ?? 'NEW',
    },
  });
  createdTicketIds.push(ticket.id);
  return ticket;
}

// ---------------------------------------------------------------------------
// GET/POST /api/tickets/:id/comments (api-spec.md §3.1-3.2)
// ---------------------------------------------------------------------------

describe('GET /api/tickets/:id/comments', () => {
  it('API-34: a posted comment appears in the thread ordered createdAt ascending', async () => {
    const requester = await createUser('REQUESTER');
    const itStaff = await createUser('IT_STAFF');
    const ticket = await createTicket(requester.id);
    const requesterCookie = await loginAndGetCookie(requester.email);
    const staffCookie = await loginAndGetCookie(itStaff.email);

    const first = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Cookie', requesterCookie)
      .set('Content-Type', 'application/json')
      .send({ body: 'I restarted the laptop and it still fails at the login screen.' });
    expect(first.status).toBe(201);

    const second = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Cookie', staffCookie)
      .set('Content-Type', 'application/json')
      .send({ body: 'Thanks — can you try a different network cable?' });
    expect(second.status).toBe(201);

    const res = await request(testServer.server)
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Cookie', requesterCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({
      id: first.body.id,
      body: 'I restarted the laptop and it still fails at the login screen.',
      createdAt: first.body.createdAt,
      author: { id: requester.id, name: requester.name, role: 'REQUESTER' },
    });
    expect(res.body[1]).toEqual({
      id: second.body.id,
      body: 'Thanks — can you try a different network cable?',
      createdAt: second.body.createdAt,
      author: { id: itStaff.id, name: itStaff.name, role: 'IT_STAFF' },
    });
    expect(new Date(res.body[0].createdAt).getTime()).toBeLessThanOrEqual(
      new Date(res.body[1].createdAt).getTime(),
    );
  });

  it('an Administrator can read the thread (BR-04)', async () => {
    const requester = await createUser('REQUESTER');
    const admin = await createUser('ADMINISTRATOR');
    const ticket = await createTicket(requester.id);
    const adminCookie = await loginAndGetCookie(admin.email);

    const res = await request(testServer.server)
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  describe('ownership and existence (§1.4 case 2 — byte-identical 404)', () => {
    it("a Requester reading another Requester's ticket comments gets 404, identical to an unknown ticket id", async () => {
      const owner = await createUser('REQUESTER', { emailPrefix: 'owner' });
      const stranger = await createUser('REQUESTER', { emailPrefix: 'stranger' });
      const ticket = await createTicket(owner.id);
      const strangerCookie = await loginAndGetCookie(stranger.email);

      const notOwnedRes = await request(testServer.server)
        .get(`/api/tickets/${ticket.id}/comments`)
        .set('Cookie', strangerCookie);
      const unknownRes = await request(testServer.server)
        .get(`/api/tickets/${ticket.id + 1_000_000}/comments`)
        .set('Cookie', strangerCookie);

      expect(notOwnedRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(notOwnedRes.body).toEqual(unknownRes.body);
      expect(notOwnedRes.body.error).toBe('NOT_FOUND');
      expect('fields' in notOwnedRes.body).toBe(false);
    });

    it('no session is 401 before any lookup', async () => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id);

      const res = await request(testServer.server).get(`/api/tickets/${ticket.id}/comments`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });
  });
});

describe('POST /api/tickets/:id/comments', () => {
  it('API-34: the owning Requester can post; author and createdAt come from the server, not the client', async () => {
    const requester = await createUser('REQUESTER');
    const ticket = await createTicket(requester.id);
    const cookie = await loginAndGetCookie(requester.email);

    const res = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send({
        body: 'Still broken after the restart.',
        // BR-16: client-supplied author/createdAt must be ignored.
        author: { id: 999_999, name: 'Someone Else', role: 'ADMINISTRATOR' },
        createdAt: '2000-01-01T00:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      body: 'Still broken after the restart.',
      createdAt: expect.any(String),
      author: { id: requester.id, name: requester.name, role: 'REQUESTER' },
    });
    expect(res.body.createdAt).not.toBe('2000-01-01T00:00:00.000Z');

    const stored = await prisma.publicComment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.authorId).toBe(requester.id);
    expect(stored.ticketId).toBe(ticket.id);
  });

  it('API-36: IT Staff can post on a ticket they do not own, and it is visible to the owning Requester', async () => {
    const requester = await createUser('REQUESTER');
    const itStaff = await createUser('IT_STAFF');
    const ticket = await createTicket(requester.id);
    const staffCookie = await loginAndGetCookie(itStaff.email);
    const requesterCookie = await loginAndGetCookie(requester.email);

    const postRes = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Cookie', staffCookie)
      .set('Content-Type', 'application/json')
      .send({ body: 'We are looking into this now.' });

    expect(postRes.status).toBe(201);
    expect(postRes.body.author).toEqual({ id: itStaff.id, name: itStaff.name, role: 'IT_STAFF' });

    const getRes = await request(testServer.server)
      .get(`/api/tickets/${ticket.id}/comments`)
      .set('Cookie', requesterCookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveLength(1);
    expect(getRes.body[0].body).toBe('We are looking into this now.');
  });

  it('an Administrator may read but not post — 403 FORBIDDEN, not 404 (they already have a read path, §1.4 case 3)', async () => {
    const requester = await createUser('REQUESTER');
    const admin = await createUser('ADMINISTRATOR');
    const ticket = await createTicket(requester.id);
    const adminCookie = await loginAndGetCookie(admin.email);

    const res = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/comments`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'application/json')
      .send({ body: 'Administrators should not be able to post this.' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');

    const count = await prisma.publicComment.count({ where: { ticketId: ticket.id } });
    expect(count).toBe(0);
  });

  describe('API-35: comment validation (AC-22, AC-23, BR-17)', () => {
    it.each([
      ['missing', undefined],
      ['empty string', ''],
      ['whitespace-only', '   \n\t  '],
      ['2001 characters (over the 2000 maximum)', 'a'.repeat(2001)],
    ] as const)('rejects a body that is %s with 400 VALIDATION_FAILED; nothing persisted', async (_label, body) => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id);
      const cookie = await loginAndGetCookie(requester.email);

      const res = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json')
        .send(body === undefined ? {} : { body });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');
      expect(res.body.fields).toEqual([{ field: 'body', message: expect.any(String) }]);

      const count = await prisma.publicComment.count({ where: { ticketId: ticket.id } });
      expect(count).toBe(0);
    });

    it('accepts exactly 2000 characters', async () => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id);
      const cookie = await loginAndGetCookie(requester.email);

      const res = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json')
        .send({ body: 'a'.repeat(2000) });

      expect(res.status).toBe(201);
      expect(res.body.body).toHaveLength(2000);
    });

    it('trims leading/trailing whitespace before storing, and before the length check (BR-17)', async () => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id);
      const cookie = await loginAndGetCookie(requester.email);

      const res = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json')
        .send({ body: '   Padded on both sides.   ' });

      expect(res.status).toBe(201);
      expect(res.body.body).toBe('Padded on both sides.');
    });
  });

  describe('ownership, existence and content type', () => {
    it("a Requester posting on another Requester's ticket gets 404, identical to an unknown ticket id; nothing persisted", async () => {
      const owner = await createUser('REQUESTER', { emailPrefix: 'owner' });
      const stranger = await createUser('REQUESTER', { emailPrefix: 'stranger' });
      const ticket = await createTicket(owner.id);
      const strangerCookie = await loginAndGetCookie(stranger.email);

      const notOwnedRes = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Cookie', strangerCookie)
        .set('Content-Type', 'application/json')
        .send({ body: 'Trying to comment on a ticket I do not own.' });
      const unknownRes = await request(testServer.server)
        .post(`/api/tickets/${ticket.id + 1_000_000}/comments`)
        .set('Cookie', strangerCookie)
        .set('Content-Type', 'application/json')
        .send({ body: 'Trying to comment on a ticket that does not exist.' });

      expect(notOwnedRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(notOwnedRes.body).toEqual(unknownRes.body);

      const count = await prisma.publicComment.count({ where: { ticketId: ticket.id } });
      expect(count).toBe(0);
    });

    it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON Content-Type (BR-40)', async () => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id);
      const cookie = await loginAndGetCookie(requester.email);

      const res = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Cookie', cookie)
        .set('Content-Type', 'text/plain')
        .send('body=whatever');

      expect(res.status).toBe(415);
      expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');

      const count = await prisma.publicComment.count({ where: { ticketId: ticket.id } });
      expect(count).toBe(0);
    });

    it('no session is 401 before any lookup', async () => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id);

      const res = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Content-Type', 'application/json')
        .send({ body: 'No session at all.' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/requester-resolved (api-spec.md §3.3)
// ---------------------------------------------------------------------------

describe('POST /api/tickets/:id/requester-resolved', () => {
  it('API-39: sets requesterResolvedAt, leaves status unchanged, and is idempotent on repeat calls', async () => {
    const requester = await createUser('REQUESTER');
    const ticket = await createTicket(requester.id, { status: 'OPEN' });
    const cookie = await loginAndGetCookie(requester.email);

    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(before.requesterResolvedAt).toBeNull();

    const first = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/requester-resolved`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send();

    expect(first.status).toBe(204);
    expect(first.body).toEqual({});

    const afterFirst = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(afterFirst.requesterResolvedAt).not.toBeNull();
    expect(afterFirst.status).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 10)); // ensure a distinguishable timestamp

    const second = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/requester-resolved`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send();

    expect(second.status).toBe(204);

    const afterSecond = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(afterSecond.status).toBe('OPEN');
    expect(afterSecond.requesterResolvedAt!.getTime()).toBeGreaterThan(afterFirst.requesterResolvedAt!.getTime());
  });

  it('ui-spec.md §7: the indication survives a reload — GET /api/tickets/:id reflects requesterResolvedAt and owner for the Requester', async () => {
    const requester = await createUser('REQUESTER');
    const ticket = await createTicket(requester.id);
    const cookie = await loginAndGetCookie(requester.email);

    const before = await request(testServer.server)
      .get(`/api/tickets/${ticket.id}`)
      .set('Cookie', cookie);
    expect(before.status).toBe(200);
    expect(before.body.requesterResolvedAt).toBeNull();
    expect(before.body.owner).toBeNull();
    expect(before.body).not.toHaveProperty('itPriority');

    const resolveRes = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/requester-resolved`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send();
    expect(resolveRes.status).toBe(204);

    const after = await request(testServer.server)
      .get(`/api/tickets/${ticket.id}`)
      .set('Cookie', cookie);
    expect(after.status).toBe(200);
    expect(after.body.requesterResolvedAt).toEqual(expect.any(String));
    expect(after.body.status).toBe(ticket.status);
  });

  // AC-25: "Given a Requester, when they attempt to set a Ticket to
  // Resolved or Closed by any endpoint, then it is refused." The only
  // resolution-adjacent endpoint a Requester can reach at all, on this
  // branch, is this one — PATCH /api/tickets/:id/status (the actual status
  // transition endpoint, IT Staff only) is issue #71's route and does not
  // exist yet, so there is no second endpoint to exercise "by any
  // endpoint" against honestly. What IS fully testable now is that this
  // endpoint itself never functions as a disguised status-setter, no
  // matter how it's called — which is the complete Requester-reachable
  // surface for FR-18/BR-05 today.
  it('API-40: never changes status to RESOLVED or CLOSED, called once or repeatedly, regardless of starting status', async () => {
    const requester = await createUser('REQUESTER');
    const ticket = await createTicket(requester.id, { status: 'NEW' });
    const cookie = await loginAndGetCookie(requester.email);

    for (let i = 0; i < 3; i++) {
      const res = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/requester-resolved`)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json')
        .send();
      expect(res.status).toBe(204);
    }

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.status).toBe('NEW');
    expect(after.status).not.toBe('RESOLVED');
    expect(after.status).not.toBe('CLOSED');
  });

  it.each(['RESOLVED', 'CLOSED', 'CANCELLED'] as const)(
    '409 INVALID_STATE when the ticket is already %s',
    async (status) => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id, { status });
      const cookie = await loginAndGetCookie(requester.email);

      const res = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/requester-resolved`)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_STATE');

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.requesterResolvedAt).toBeNull();
    },
  );

  it.each(['IT_STAFF', 'ADMINISTRATOR'] as const)(
    '%s gets 403, not 404, on an existing ticket (§1.4 case 3 — they can already read it)',
    async (role) => {
      const requester = await createUser('REQUESTER');
      const staffOrAdmin = await createUser(role);
      const ticket = await createTicket(requester.id);
      const cookie = await loginAndGetCookie(staffOrAdmin.email);

      const res = await request(testServer.server)
        .post(`/api/tickets/${ticket.id}/requester-resolved`)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.requesterResolvedAt).toBeNull();
    },
  );

  it("a Requester on another Requester's ticket gets 404, identical to an unknown ticket id (§1.4 case 2)", async () => {
    const owner = await createUser('REQUESTER', { emailPrefix: 'owner' });
    const stranger = await createUser('REQUESTER', { emailPrefix: 'stranger' });
    const ticket = await createTicket(owner.id);
    const strangerCookie = await loginAndGetCookie(stranger.email);

    const notOwnedRes = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/requester-resolved`)
      .set('Cookie', strangerCookie)
      .set('Content-Type', 'application/json')
      .send();
    const unknownRes = await request(testServer.server)
      .post(`/api/tickets/${ticket.id + 1_000_000}/requester-resolved`)
      .set('Cookie', strangerCookie)
      .set('Content-Type', 'application/json')
      .send();

    expect(notOwnedRes.status).toBe(404);
    expect(unknownRes.status).toBe(404);
    expect(notOwnedRes.body).toEqual(unknownRes.body);
  });

  it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON Content-Type (BR-40)', async () => {
    const requester = await createUser('REQUESTER');
    const ticket = await createTicket(requester.id);
    const cookie = await loginAndGetCookie(requester.email);

    const res = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/requester-resolved`)
      .set('Cookie', cookie)
      .set('Content-Type', 'text/plain')
      .send('');

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.requesterResolvedAt).toBeNull();
  });

  it('no session is 401 before any lookup', async () => {
    const requester = await createUser('REQUESTER');
    const ticket = await createTicket(requester.id);

    const res = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/requester-resolved`)
      .set('Content-Type', 'application/json')
      .send();

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });
});
