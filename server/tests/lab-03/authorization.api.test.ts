import { afterEach, describe, expect, it, vi } from 'vitest';
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
// tests.md's SEC-01..SEC-09 describe behaviour on routes that do not exist
// yet under session auth: the IT Staff Ticket Queue (`GET
// /api/staff/tickets`, #71), Administrator routes (`GET`/`POST
// /api/users`, etc., #73), and a Requester-owned Ticket lookup whose 404
// depends on session-based ownership (`GET /api/tickets/:id`, rewired by
// #70 — today it still runs on the Lab 2 `X-Requester-Id` mechanism, which
// this issue explicitly does not touch). Writing real assertions against
// those routes now would mean inventing stub endpoints nobody else owns,
// which is exactly the scope creep this issue's brief warns against — any
// such stub would need to be deleted and redone once #70/#71/#73 build the
// real thing.
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
//
// What is NOT real here, and why — mapped to tests.md's row IDs:
//
//   - SEC-02 (Requester -> staff queue, Requester/IT Staff -> admin routes,
//     all 403 before lookup): the GENERAL MECHANISM this row needs
//     (role-gated collection -> 403 before any lookup) is fully proven
//     below against a throwaway route. The SPECIFIC assertions SEC-02 names
//     — against the real `/api/staff/tickets` and `/api/users` paths — are
//     deferred to #71 and #73, each of which need only mount `requireRole`
//     with the right allowed set; no new authorization logic remains to
//     write once they do.
//   - SEC-03 (client-supplied `requesterId`/foreign path id ignored) and
//     SEC-04 (Requester's own Ticket 404 for another Requester's Ticket,
//     byte-identical to a nonexistent one): both depend on `GET
//     /api/tickets/:id` running on session identity instead of
//     `X-Requester-Id`. Deferred to #70.
//   - SEC-05 (Internal Notes -> 404 for a Requester, never 403 or leaked
//     content) and SEC-06 (Administrator: IT Priority 200, status/owner/note
//     -write all 403 because they CAN already read the ticket): both need
//     `GET /api/tickets/:id/notes`, `PATCH /api/tickets/:id/status`, `PATCH
//     /api/tickets/:id/owner`, `POST /api/tickets/:id/notes` and `PATCH
//     /api/tickets/:id/it-priority` to exist on session auth. Deferred to
//     #70 (ticket read path) and #71 (the IT Staff write routes
//     themselves).
//   - SEC-07 (every state-changing route rejects a non-JSON Content-Type
//     with 415): already real, HTTP-level coverage exists today for every
//     state-changing route that exists under session auth — every
//     `POST`/`PATCH` under `/api/auth/*` — in
//     server/tests/lab-03/auth.api.test.ts (its own AC-63 cases: login,
//     logout, change-password). Not re-tested here to avoid duplicating
//     real coverage. The remaining routes named implicitly by "every
//     state-changing route" (tickets, staff, users) don't exist under
//     session auth yet; each future router must mount its own
//     `requireJsonContentType`-equivalent per api-spec.md §1.6 (BR-40) —
//     `src/routes/auth.ts`'s own `requireJsonContentType` doc comment
//     already flags this as a router-by-router decision, not a global one.
//   - SEC-08 (a forced internal error returns the generic `INTERNAL` body,
//     no stack/SQL/path): the exact `{ error: 'INTERNAL', message }` shape
//     is not novel to this issue — `authenticate`'s own catch block in
//     src/middleware/authContext.ts uses it, and it's already exercised by
//     several existing suites (server/tests/lab-02/reference-data.api.test.ts,
//     create-ticket.api.test.ts, attachments.api.test.ts) and by
//     auth.api.test.ts's own `internalError`. There is no new route this
//     issue adds to force an error against, so full SEC-08 coverage across
//     every future protected endpoint is deferred to whichever issue builds
//     each one.
//   - SEC-09 (Requester and IT Staff both 403 on all four Administrator user
//     routes): needs `GET`/`POST /api/users`, `PATCH /api/users/:id`, `POST
//     /api/users/:id/initial-password` to exist. Deferred to #73. Same
//     mechanism note as SEC-02 — once #73 mounts
//     `requireRole('ADMINISTRATOR')`, SEC-09's own assertions are close to
//     mechanical.
//
// This codebase has no existing use of `it.todo` anywhere (checked via
// `grep -rn "it.todo" server/tests client/tests` before writing this file —
// zero hits), so rather than introduce an unprecedented pattern, deferred
// rows are recorded here as comments, next to the row they defer, instead
// of as `it.todo(...)` stubs. Nothing below is skipped, disabled, or
// asserted as passing when it isn't.

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
