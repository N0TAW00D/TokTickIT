import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import { useTestServer } from '../setup/http-server.js';
import type { Role } from '../../src/generated/prisma/client.js';

// GET/POST /api/tickets/:id/notes — docs/lab-03/api-spec.md §5.4-5.5 (FR-25,
// FR-26; BR-04, BR-15..BR-18; AC-04, AC-41, AC-66). Issue #72's half of
// Internal Notes — comments-notes.api.test.ts (issue #70) deliberately does
// not test this route; see that file's own top-of-file note.
//
// The key behavioral difference from Public Comments (comments-notes.api.
// test.ts): a Requester has NO path to Internal Notes at all, not even for
// their own ticket. §1.4's case-2 rule ("no read path -> 404, not 403")
// applies to the Requester here regardless of ownership, so both GET and
// POST collapse the owning-Requester case to the identical 404 an unknown
// ticket id would produce (SEC-05, AC-04). IT Staff and Administrator both
// have a read path (BR-04); only IT Staff has a write path — an
// Administrator's read path makes a write attempt a safe 403, never a 404
// (AC-68), mirroring POST /api/tickets/:id/comments' identical Administrator
// check.

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
  const email = `notes-test-${emailPrefix}-${Math.random().toString(36).slice(2)}-${Date.now()}@example.edu`;

  const user = await prisma.user.create({
    data: { name: `Notes Test ${role}`, email, role, isActive: true, mustChangePassword: false, passwordHash },
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

async function createTicket(requesterId: number) {
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const ticketNumber = `TKT-NOTES-${Math.random().toString(36).slice(2)}`;

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber,
      requesterId,
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary: 'A ticket used to exercise Internal Notes',
      description: 'Description text long enough to satisfy the 20-character minimum for this field.',
      requestedPriority: 'MEDIUM',
      itPriority: 'MEDIUM',
      status: 'NEW',
    },
  });
  createdTicketIds.push(ticket.id);
  return ticket;
}

function getNotes(ticketId: number | string, cookie?: string) {
  const req = request(testServer.server).get(`/api/tickets/${ticketId}/notes`);
  return cookie === undefined ? req : req.set('Cookie', cookie);
}

function postNote(ticketId: number | string, body: unknown, cookie?: string) {
  const req = request(testServer.server).post(`/api/tickets/${ticketId}/notes`).set('Content-Type', 'application/json');
  const withCookie = cookie === undefined ? req : req.set('Cookie', cookie);
  return withCookie.send(body as object);
}

// ---------------------------------------------------------------------------
// GET/POST /api/tickets/:id/notes (api-spec.md §5.4-5.5)
// ---------------------------------------------------------------------------

describe('GET /api/tickets/:id/notes', () => {
  it('a posted note appears in the thread ordered createdAt ascending', async () => {
    const requester = await createUser('REQUESTER');
    const itStaff = await createUser('IT_STAFF');
    const ticket = await createTicket(requester.id);
    const staffCookie = await loginAndGetCookie(itStaff.email);

    const first = await postNote(ticket.id, { body: 'First triage note.' }, staffCookie);
    expect(first.status).toBe(201);

    const second = await postNote(ticket.id, { body: 'Second triage note.' }, staffCookie);
    expect(second.status).toBe(201);

    const third = await postNote(ticket.id, { body: 'Third triage note.' }, staffCookie);
    expect(third.status).toBe(201);

    const res = await getNotes(ticket.id, staffCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toEqual({
      id: first.body.id,
      body: 'First triage note.',
      createdAt: first.body.createdAt,
      author: { id: itStaff.id, name: itStaff.name, role: 'IT_STAFF' },
    });
    expect(res.body[1].id).toBe(second.body.id);
    expect(res.body[2].id).toBe(third.body.id);
    expect(new Date(res.body[0].createdAt).getTime()).toBeLessThanOrEqual(
      new Date(res.body[1].createdAt).getTime(),
    );
    expect(new Date(res.body[1].createdAt).getTime()).toBeLessThanOrEqual(
      new Date(res.body[2].createdAt).getTime(),
    );
  });

  it('an Administrator can read the thread and sees an IT Staff note (BR-04)', async () => {
    const requester = await createUser('REQUESTER');
    const itStaff = await createUser('IT_STAFF');
    const admin = await createUser('ADMINISTRATOR');
    const ticket = await createTicket(requester.id);
    const staffCookie = await loginAndGetCookie(itStaff.email);
    const adminCookie = await loginAndGetCookie(admin.email);

    const posted = await postNote(ticket.id, { body: 'Internal-only detail.' }, staffCookie);
    expect(posted.status).toBe(201);

    const res = await getNotes(ticket.id, adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].body).toBe('Internal-only detail.');
    expect(res.body[0].author).toEqual({ id: itStaff.id, name: itStaff.name, role: 'IT_STAFF' });
  });

  describe('Requester has no read path at all (§1.4 case 2 — byte-identical 404, SEC-05)', () => {
    it('a Requester reading notes on their own ticket gets 404, not 403, not 200', async () => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id);
      const cookie = await loginAndGetCookie(requester.email);

      const res = await getNotes(ticket.id, cookie);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect('fields' in res.body).toBe(false);
    });

    it("a Requester reading notes on another Requester's ticket gets a byte-identical 404", async () => {
      const owner = await createUser('REQUESTER', { emailPrefix: 'owner' });
      const stranger = await createUser('REQUESTER', { emailPrefix: 'stranger' });
      const ticket = await createTicket(owner.id);
      const ownerCookie = await loginAndGetCookie(owner.email);
      const strangerCookie = await loginAndGetCookie(stranger.email);

      const ownTicketRes = await getNotes(ticket.id, ownerCookie);
      const strangerRes = await getNotes(ticket.id, strangerCookie);
      const unknownRes = await getNotes(ticket.id + 1_000_000, strangerCookie);

      expect(ownTicketRes.status).toBe(404);
      expect(strangerRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(ownTicketRes.body).toEqual(strangerRes.body);
      expect(strangerRes.body).toEqual(unknownRes.body);
    });
  });

  it('unknown ticket id -> 404 NOT_FOUND for IT Staff too', async () => {
    const requester = await createUser('REQUESTER');
    const itStaff = await createUser('IT_STAFF');
    const ticket = await createTicket(requester.id);
    const staffCookie = await loginAndGetCookie(itStaff.email);

    const res = await getNotes(ticket.id + 1_000_000, staffCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('unknown ticket id -> 404 NOT_FOUND for Administrator too', async () => {
    const requester = await createUser('REQUESTER');
    const admin = await createUser('ADMINISTRATOR');
    const ticket = await createTicket(requester.id);
    const adminCookie = await loginAndGetCookie(admin.email);

    const res = await getNotes(ticket.id + 1_000_000, adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('no session is 401 before any lookup', async () => {
    const requester = await createUser('REQUESTER');
    const ticket = await createTicket(requester.id);

    const res = await getNotes(ticket.id);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/tickets/:id/notes', () => {
  it('IT Staff can post a note; author and createdAt come from the server, not the client', async () => {
    const requester = await createUser('REQUESTER');
    const itStaff = await createUser('IT_STAFF');
    const ticket = await createTicket(requester.id);
    const staffCookie = await loginAndGetCookie(itStaff.email);

    const res = await postNote(
      ticket.id,
      {
        body: 'Escalating to network team.',
        // BR-16: client-supplied author/createdAt must be ignored.
        author: { id: 999_999, name: 'Someone Else', role: 'ADMINISTRATOR' },
        createdAt: '2000-01-01T00:00:00.000Z',
      },
      staffCookie,
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      body: 'Escalating to network team.',
      createdAt: expect.any(String),
      author: { id: itStaff.id, name: itStaff.name, role: 'IT_STAFF' },
    });
    expect(res.body.createdAt).not.toBe('2000-01-01T00:00:00.000Z');

    const stored = await prisma.internalNote.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.authorId).toBe(itStaff.id);
    expect(stored.ticketId).toBe(ticket.id);
  });

  it('an Administrator may read but not post — 403 FORBIDDEN, not 404 (they already have a read path)', async () => {
    const requester = await createUser('REQUESTER');
    const admin = await createUser('ADMINISTRATOR');
    const ticket = await createTicket(requester.id);
    const adminCookie = await loginAndGetCookie(admin.email);

    const res = await postNote(ticket.id, { body: 'Administrators should not be able to post this.' }, adminCookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');

    const count = await prisma.internalNote.count({ where: { ticketId: ticket.id } });
    expect(count).toBe(0);
  });

  describe('validation (BR-17)', () => {
    it.each([
      ['missing', undefined],
      ['empty string', ''],
      ['whitespace-only', '   \n\t  '],
      ['2001 characters (over the 2000 maximum)', 'a'.repeat(2001)],
    ] as const)('rejects a body that is %s with 400 VALIDATION_FAILED; nothing persisted', async (_label, body) => {
      const requester = await createUser('REQUESTER');
      const itStaff = await createUser('IT_STAFF');
      const ticket = await createTicket(requester.id);
      const staffCookie = await loginAndGetCookie(itStaff.email);

      const res = await postNote(ticket.id, body === undefined ? {} : { body }, staffCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');
      expect(res.body.fields).toEqual([{ field: 'body', message: expect.any(String) }]);

      const count = await prisma.internalNote.count({ where: { ticketId: ticket.id } });
      expect(count).toBe(0);
    });

    it('accepts exactly 2000 characters', async () => {
      const requester = await createUser('REQUESTER');
      const itStaff = await createUser('IT_STAFF');
      const ticket = await createTicket(requester.id);
      const staffCookie = await loginAndGetCookie(itStaff.email);

      const res = await postNote(ticket.id, { body: 'a'.repeat(2000) }, staffCookie);

      expect(res.status).toBe(201);
      expect(res.body.body).toHaveLength(2000);
    });
  });

  describe('Requester has no write path at all (byte-identical 404)', () => {
    it('a Requester posting a note on their own ticket gets 404; nothing persisted', async () => {
      const requester = await createUser('REQUESTER');
      const ticket = await createTicket(requester.id);
      const cookie = await loginAndGetCookie(requester.email);

      const res = await postNote(ticket.id, { body: 'Requesters should not be able to post this.' }, cookie);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');

      const count = await prisma.internalNote.count({ where: { ticketId: ticket.id } });
      expect(count).toBe(0);
    });

    it("a Requester posting a note on another Requester's ticket gets a byte-identical 404", async () => {
      const owner = await createUser('REQUESTER', { emailPrefix: 'owner' });
      const stranger = await createUser('REQUESTER', { emailPrefix: 'stranger' });
      const ticket = await createTicket(owner.id);
      const ownerCookie = await loginAndGetCookie(owner.email);
      const strangerCookie = await loginAndGetCookie(stranger.email);

      const ownTicketRes = await postNote(ticket.id, { body: 'On my own ticket.' }, ownerCookie);
      const strangerRes = await postNote(ticket.id, { body: 'On a ticket I do not own.' }, strangerCookie);
      const unknownRes = await postNote(ticket.id + 1_000_000, { body: 'On a ticket that does not exist.' }, strangerCookie);

      expect(ownTicketRes.status).toBe(404);
      expect(strangerRes.status).toBe(404);
      expect(unknownRes.status).toBe(404);
      expect(ownTicketRes.body).toEqual(strangerRes.body);
      expect(strangerRes.body).toEqual(unknownRes.body);

      const count = await prisma.internalNote.count({ where: { ticketId: ticket.id } });
      expect(count).toBe(0);
    });
  });

  it('unknown ticket id -> 404 NOT_FOUND for IT Staff too', async () => {
    const requester = await createUser('REQUESTER');
    const itStaff = await createUser('IT_STAFF');
    const ticket = await createTicket(requester.id);
    const staffCookie = await loginAndGetCookie(itStaff.email);

    const res = await postNote(ticket.id + 1_000_000, { body: 'Trying to note a ticket that does not exist.' }, staffCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('unknown ticket id -> 404 NOT_FOUND for Administrator too', async () => {
    const requester = await createUser('REQUESTER');
    const admin = await createUser('ADMINISTRATOR');
    const ticket = await createTicket(requester.id);
    const adminCookie = await loginAndGetCookie(admin.email);

    const res = await postNote(ticket.id + 1_000_000, { body: 'Trying to note a ticket that does not exist.' }, adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON Content-Type (BR-40)', async () => {
    const requester = await createUser('REQUESTER');
    const itStaff = await createUser('IT_STAFF');
    const ticket = await createTicket(requester.id);
    const staffCookie = await loginAndGetCookie(itStaff.email);

    const res = await request(testServer.server)
      .post(`/api/tickets/${ticket.id}/notes`)
      .set('Cookie', staffCookie)
      .set('Content-Type', 'text/plain')
      .send('body=whatever');

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');

    const count = await prisma.internalNote.count({ where: { ticketId: ticket.id } });
    expect(count).toBe(0);
  });

  it('no session is 401 before any lookup', async () => {
    const requester = await createUser('REQUESTER');
    const ticket = await createTicket(requester.id);

    const res = await postNote(ticket.id, { body: 'No session at all.' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });
});
