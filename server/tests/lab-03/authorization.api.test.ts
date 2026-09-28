import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import { useTestServer } from '../setup/http-server.js';
import { authenticate, passwordChangeGate, requireRole } from '../../src/middleware/authContext.js';
import type { Role } from '../../src/generated/prisma/client.js';

// Issue #69 (docs/lab-03/specification.md §4 FR-09..FR-13, §4.1; api-spec.md
// §1.4; tests.md's authorization.api.test.ts row set, SEC-01..SEC-09).
//
// -----------------------------------------------------------------------
// Honest scope of this file — read before adding to or trusting it
// -----------------------------------------------------------------------
//
// tests.md's SEC-01..SEC-09 describe behaviour on routes that, when this
// file was first written for #69, did not exist yet under session auth: the
// IT Staff Ticket Queue (`GET /api/staff/tickets`, #71), Administrator
// routes (`GET`/`POST /api/users`, etc., #73), and a Requester-owned Ticket
// lookup whose 404 depends on session-based ownership (`GET
// /api/tickets/:id`, rewired by #70). #70/#71/#72/#73 have since landed, so
// every one of SEC-01..SEC-09 now has real, route-specific coverage — this
// file was deliberately never turned into the place that duplicates it, to
// avoid the same assertion living in two files. See "Where the rest of
// SEC-01..SEC-09 actually live" below for the current mapping.
//
// What IS real, and lives below:
//
//   - `requireRole` (src/middleware/authContext.ts) — the reusable FR-10 /
//     api-spec.md §1.4-case-1 middleware this issue delivers. Covered both
//     directly (constructed req/res/next, mirroring auth.api.test.ts's own
//     `passwordChangeGate` unit-coverage pattern) and composed with
//     `authenticate` + `passwordChangeGate` over real HTTP, against a
//     throwaway router mounted only in this file (never on the real `app`).
//   - The full `authenticate -> passwordChangeGate -> requireRole` ordering
//     — unauthenticated first (FR-09), then the password-change gate
//     (AC-70), then role (FR-10) — proven end-to-end, which is new: #68's
//     own suite never composed a role check into the chain because
//     `requireRole` didn't exist yet.
//   - SEC-01 (every protected route 401s and performs no write), proven
//     end-to-end against the real `app` further below.
//
// Where the rest of SEC-01..SEC-09 actually live, now that #70/#71/#72/#73
// have landed and built the routes this file's own SEC rows describe — none
// of it is duplicated here, per tests.md's File column:
//
//   - SEC-02 (Requester -> staff queue, Requester/IT Staff -> admin routes,
//     all 403 before lookup): the GENERAL MECHANISM (role-gated collection
//     -> 403 before any lookup) is proven below against a throwaway route;
//     the real, route-specific assertions are
//     server/tests/lab-03/staff-queue.api.test.ts ("403 FORBIDDEN for a
//     Requester, before any lookup" on `GET /api/staff/tickets`) and
//     server/tests/lab-03/users-admin.api.test.ts (Requester and IT Staff
//     403 on each of the four `/api/users*` routes).
//   - SEC-03 (client-supplied `requesterId`/foreign path id ignored) and
//     SEC-04 (Requester's own Ticket 404 for another Requester's Ticket,
//     byte-identical to a nonexistent one): SEC-03 is
//     server/tests/lab-02/create-ticket.api.test.ts's API-08 ("a
//     requesterId in the body is ignored") plus
//     server/tests/lab-02/attachments.api.test.ts's ownership-boundary
//     cases (a foreign path id never changes whose data is returned); SEC-04
//     is server/tests/lab-02/ticket-detail.api.test.ts's API-20 ("not owned
//     / unknown — byte-identical 404").
//   - SEC-05 (Internal Notes -> 404 for a Requester, never 403 or leaked
//     content): server/tests/lab-03/ticket-notes.api.test.ts, "Requester has
//     no read path at all (§1.4 case 2 — byte-identical 404, SEC-05)".
//   - SEC-06 (Administrator: IT Priority 200, status/owner/note-write all
//     403 because they CAN already read the ticket): Admin 200 is
//     server/tests/lab-03/ticket-it-priority.api.test.ts ("Administrator can
//     ALSO change itPriority, 200"); Admin 403 is spread across
//     server/tests/lab-03/ticket-status.api.test.ts, ticket-owner.api.test.ts
//     and ticket-notes.api.test.ts (each has its own "403 FORBIDDEN for an
//     Administrator" / "may read but not post" case).
//   - SEC-07 (every state-changing route rejects a non-JSON Content-Type
//     with 415): each route's own test file carries its 415 case —
//     server/tests/lab-03/auth.api.test.ts, comments-notes.api.test.ts,
//     ticket-owner.api.test.ts, ticket-status.api.test.ts,
//     ticket-it-priority.api.test.ts, ticket-notes.api.test.ts and
//     users-admin.api.test.ts. Not re-tested here to avoid duplicating real
//     coverage.
//   - SEC-08 (a forced internal error returns the generic `INTERNAL` body,
//     no stack/SQL/path): the exact `{ error: 'INTERNAL', message }` shape
//     is exercised by server/tests/lab-02/create-ticket.api.test.ts (its
//     "unexpected error" case explicitly asserts no `/Users`, no `.ts`, no
//     `SELECT`, no stack-trace frame in the body), and by the same
//     `INTERNAL` shape in reference-data.api.test.ts and
//     attachments.api.test.ts.
//   - SEC-09 (Requester and IT Staff both 403 on all four Administrator user
//     routes): server/tests/lab-03/users-admin.api.test.ts — same file and
//     mechanism as SEC-02's admin-routes half above.
//
// This codebase has no existing use of `it.todo` anywhere. Nothing below is
// skipped, disabled, or asserted as passing when it isn't.

const testServer = useTestServer(app);

let createdUserIds: number[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds = [];
  }
});

const DEFAULT_PASSWORD = 'CorrectHorseBattery1';

async function createUser(role: Role, options: { mustChangePassword?: boolean } = {}) {
  const { mustChangePassword = false } = options;
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const email = `authz-test-${role.toLowerCase()}-${Math.random().toString(36).slice(2)}-${Date.now()}@example.edu`;

  const user = await prisma.user.create({
    data: { name: 'Authorization Test User', email, role, isActive: true, mustChangePassword, passwordHash },
  });
  createdUserIds.push(user.id);
  return user;
}

async function loginAndGetCookie(email: string, password: string): Promise<string> {
  const res = await request(testServer.server)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password });
  expect(res.status, 'test fixture login must succeed').toBe(200);
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  const raw = setCookie.find((c) => c.startsWith('toktickit.sid='));
  if (!raw) throw new Error('Response carried no session cookie');
  return raw.split(';')[0];
}

// ---------------------------------------------------------------------------
// requireRole — direct unit coverage (FR-10; api-spec.md §1.4 case 1; §8's
// FORBIDDEN row). Mirrors the mock req/res/next pattern
// auth.api.test.ts already uses for passwordChangeGate's own unit coverage.
// ---------------------------------------------------------------------------

function mockResponse() {
  const res: { statusCode?: number; body?: unknown } = {};
  const fake = {
    status(code: number) {
      res.statusCode = code;
      return fake;
    },
    json(payload: unknown) {
      res.body = payload;
      return fake;
    },
  };
  return { res, fake: fake as unknown as Response };
}

function mockAuthenticatedRequest(role: Role | undefined) {
  return {
    authUser: role
      ? { id: 1, name: 'Someone', email: 'someone@example.edu', role, mustChangePassword: false }
      : undefined,
  } as unknown as Request;
}

const ALL_ROLES: Role[] = ['REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'];

describe('requireRole — direct unit coverage (FR-10, api-spec.md §1.4 case 1)', () => {
  for (const allowedRole of ALL_ROLES) {
    it(`allows a ${allowedRole} caller through requireRole('${allowedRole}')`, () => {
      const req = mockAuthenticatedRequest(allowedRole);
      const { fake } = mockResponse();
      const next = vi.fn();

      requireRole(allowedRole)(req, fake, next);

      expect(next).toHaveBeenCalledOnce();
    });

    for (const otherRole of ALL_ROLES.filter((r) => r !== allowedRole)) {
      it(`blocks a ${otherRole} caller from a route requiring ${allowedRole} only, with 403 FORBIDDEN`, () => {
        const req = mockAuthenticatedRequest(otherRole);
        const { res, fake } = mockResponse();
        const next = vi.fn();

        requireRole(allowedRole)(req, fake, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({
          error: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        });
      });
    }
  }

  it("api-spec.md §1.3: the FORBIDDEN body never carries a 'fields' key (that's VALIDATION_FAILED/INVALID_QUERY only)", () => {
    const req = mockAuthenticatedRequest('REQUESTER');
    const { res, fake } = mockResponse();

    requireRole('IT_STAFF')(req, fake, vi.fn());

    expect(res.body).not.toHaveProperty('fields');
  });

  it('supports a multi-role allowed set — e.g. IT Priority is IT Staff OR Administrator (BR-22, AC-68)', () => {
    for (const role of ['IT_STAFF', 'ADMINISTRATOR'] as Role[]) {
      const req = mockAuthenticatedRequest(role);
      const { fake } = mockResponse();
      const next = vi.fn();

      requireRole('IT_STAFF', 'ADMINISTRATOR')(req, fake, next);

      expect(next).toHaveBeenCalledOnce();
    }

    const requesterReq = mockAuthenticatedRequest('REQUESTER');
    const { res, fake } = mockResponse();
    requireRole('IT_STAFF', 'ADMINISTRATOR')(requesterReq, fake, vi.fn());
    expect(res.statusCode).toBe(403);
  });

  it('fails closed as 401 UNAUTHENTICATED if mounted out of order, with no req.authUser (defensive branch)', () => {
    const req = mockAuthenticatedRequest(undefined);
    const { res, fake } = mockResponse();
    const next = vi.fn();

    requireRole('REQUESTER')(req, fake, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
  });
});

// ---------------------------------------------------------------------------
// requireRole composed with authenticate + passwordChangeGate — real HTTP
// integration, proving the full chain's ordering end-to-end:
//   1. no/invalid session -> 401, before any role check (FR-09)
//   2. mustChangePassword=true -> 403 PASSWORD_CHANGE_REQUIRED, even for an
//      otherwise-permitted role, before the role check ever runs (AC-70)
//   3. wrong role -> 403 FORBIDDEN, no data (FR-10)
//   4. right role, flag clear -> the route runs
//
// This is genuinely new coverage, not a duplicate of auth.api.test.ts: #68's
// suite never composed a role check into the chain, because requireRole
// didn't exist. It also extends real, HTTP-level SEC-01 coverage (tests.md
// SEC-01 / AC-14: "every protected endpoint returns 401 and performs no
// write") to a route that specifically also carries a role check — the
// existing SEC-01-relevant coverage in auth.api.test.ts (AC-59: "with no
// session it returns 401" on /me, /change-password, /logout) already proves
// this for the three auth routes that exist; this section is additional,
// not a replacement.
//
// The router below is mounted on its own, throwaway Express app — created
// fresh in this file, NEVER on the shared `app` from src/app.ts — so no
// route added for this test can leak into any other test file sharing the
// same worker's module cache, and no production router needs modification
// just to prove this middleware chain composes correctly.
// ---------------------------------------------------------------------------

const throwawayApp = express();
throwawayApp.get(
  '/__test/it-staff-only',
  authenticate,
  passwordChangeGate,
  requireRole('IT_STAFF'),
  (req: Request, res: Response) => {
    res.status(200).json({ ok: true, role: req.authUser!.role });
  },
);
const throwawayServer = useTestServer(throwawayApp);

describe('requireRole + authenticate + passwordChangeGate — composed HTTP coverage', () => {
  it('no session cookie -> 401 UNAUTHENTICATED, before any role check runs', async () => {
    const res = await request(throwawayServer.server).get('/__test/it-staff-only');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
  });

  it('an unknown/garbage session cookie -> 401 UNAUTHENTICATED, same as no cookie', async () => {
    const res = await request(throwawayServer.server)
      .get('/__test/it-staff-only')
      .set('Cookie', 'toktickit.sid=not-a-real-token');

    expect(res.status).toBe(401);
  });

  it('authenticated wrong role (Requester) -> 403 FORBIDDEN, route handler never runs', async () => {
    const requester = await createUser('REQUESTER');
    const cookie = await loginAndGetCookie(requester.email, DEFAULT_PASSWORD);

    const res = await request(throwawayServer.server).get('/__test/it-staff-only').set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('authenticated wrong role (Administrator) -> 403 FORBIDDEN too — Administrators do not perform IT Staff operations (§4.1)', async () => {
    const admin = await createUser('ADMINISTRATOR');
    const cookie = await loginAndGetCookie(admin.email, DEFAULT_PASSWORD);

    const res = await request(throwawayServer.server).get('/__test/it-staff-only').set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('authenticated, right role (IT Staff), password-change flag clear -> the route runs and returns 200', async () => {
    const staff = await createUser('IT_STAFF');
    const cookie = await loginAndGetCookie(staff.email, DEFAULT_PASSWORD);

    const res = await request(throwawayServer.server).get('/__test/it-staff-only').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, role: 'IT_STAFF' });
  });

  it('AC-70 ordering: mustChangePassword=true blocks even the right role with 403 PASSWORD_CHANGE_REQUIRED, never reaching the role check', async () => {
    const staff = await createUser('IT_STAFF', { mustChangePassword: true });
    const cookie = await loginAndGetCookie(staff.email, DEFAULT_PASSWORD);

    const res = await request(throwawayServer.server).get('/__test/it-staff-only').set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Choose a new password before continuing.',
    });
  });

  it('an inactive user whose account was deactivated mid-session -> 401, not 403 (authenticate rejects first, BR-12)', async () => {
    const staff = await createUser('IT_STAFF');
    const cookie = await loginAndGetCookie(staff.email, DEFAULT_PASSWORD);

    await prisma.user.update({ where: { id: staff.id }, data: { isActive: false } });

    const res = await request(throwawayServer.server).get('/__test/it-staff-only').set('Cookie', cookie);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SEC-01 (AC-14): "Every protected route returns 401 and performs no
// write." — the 401 half is already proven, at real HTTP-level, for every
// state-changing route in this codebase's per-route suites (e.g.
// ticket-status.api.test.ts's "401 UNAUTHENTICATED with no session cookie"
// for PATCH /:id/status, users-admin.api.test.ts's equivalent for POST
// /api/users, PATCH /api/users/:id and POST /api/users/:id/initial-password)
// — every one of those asserts `res.status === 401` and stops there.
//
// "Performs no write" was never independently checked: a 401 body proves
// the HTTP response looks right, not that the handler underneath never ran
// (a bug that returned 401 AFTER a write, or a route with `authenticate`
// accidentally dropped from one path, would look identical from the
// response alone). This section closes that gap for a representative
// sample of the state-changing routes named above — one create, one
// update, one soft-delete — by reading the row back from the database
// itself straight after the 401, instead of trusting the status code as
// proof.
//
// #70/#71/#73 have since landed the real routes this file's header comment
// (above) describes as not existing yet for SEC-01/02/09 purposes; this
// section is the one piece of that debt paid off for SEC-01 specifically —
// it is intentionally narrow (tests.md's own "representative sample"
// framing), not a full re-litigation of every route's 401 case, which
// already lives in each route's own file.
// ---------------------------------------------------------------------------

describe('SEC-01 (AC-14): unauthenticated write attempts leave the database untouched', () => {
  let categoryId: number;
  let relatedSystemId: number;
  let requesterId: number;

  beforeAll(async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
    const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
    const requester = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'REQUESTER' } });
    categoryId = category.id;
    relatedSystemId = relatedSystem.id;
    requesterId = requester.id;
  });

  let ticketSeq = 0;
  async function seedTicket() {
    ticketSeq += 1;
    return prisma.ticket.create({
      data: {
        ticketNumber: `TKT-SEC01-${String(ticketSeq).padStart(6, '0')}`,
        requesterId,
        categoryId,
        relatedSystemId,
        summary: `SEC-01 fixture ticket ${ticketSeq}`,
        description: 'x'.repeat(25),
        requestedPriority: 'MEDIUM',
        itPriority: 'MEDIUM',
        status: 'NEW',
      },
    });
  }

  it('POST /api/tickets: no Ticket row is created', async () => {
    const before = await prisma.ticket.count();

    const res = await request(testServer.server)
      .post('/api/tickets')
      .set('Content-Type', 'application/json')
      .send({
        categoryId,
        relatedSystemId,
        summary: 'A ticket an unauthenticated caller tried to create',
        description: 'x'.repeat(25),
        requestedPriority: 'MEDIUM',
      });

    expect(res.status).toBe(401);

    const after = await prisma.ticket.count();
    expect(after).toBe(before);
  });

  it('PATCH /api/tickets/:id/status: the target Ticket keeps its original status and updatedAt', async () => {
    const ticket = await seedTicket();

    const res = await request(testServer.server)
      .patch(`/api/tickets/${ticket.id}/status`)
      .set('Content-Type', 'application/json')
      .send({ status: 'OPEN' });

    expect(res.status).toBe(401);

    const reloaded = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(reloaded.status).toBe('NEW');
    expect(reloaded.updatedAt.getTime()).toBe(ticket.updatedAt.getTime());
  });

  it('POST /api/users: no User row is created for the attempted email', async () => {
    const before = await prisma.user.count();
    const email = `sec01-unauth-create-${randomUUID()}@example.edu`;

    const res = await request(testServer.server)
      .post('/api/users')
      .set('Content-Type', 'application/json')
      .send({
        name: 'Should Never Exist',
        email,
        role: 'IT_STAFF',
        isActive: true,
        initialPassword: 'InitialPass1234',
      });

    expect(res.status).toBe(401);

    const after = await prisma.user.count();
    expect(after).toBe(before);
    expect(await prisma.user.findFirst({ where: { email } })).toBeNull();
  });

  it('DELETE /api/attachments/:id: the target Attachment keeps isRemoved=false / removedAt=null', async () => {
    const ticket = await seedTicket();
    const attachment = await prisma.attachment.create({
      data: {
        ticketId: ticket.id,
        originalFilename: 'sec-01-fixture.pdf',
        storedFilename: `${randomUUID()}.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1024,
        isRemoved: false,
      },
    });

    const res = await request(testServer.server)
      .delete(`/api/attachments/${attachment.id}`)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Attempted by an unauthenticated caller' });

    expect(res.status).toBe(401);

    const reloaded = await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(reloaded.isRemoved).toBe(false);
    expect(reloaded.removedAt).toBeNull();
    expect(reloaded.removedReason).toBeNull();
    expect(reloaded.removedById).toBeNull();
  });
});
