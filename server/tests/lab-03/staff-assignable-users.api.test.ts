import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';
import type { Role } from '../../src/generated/prisma/client.js';

// GET /api/staff/assignable-users — docs/lab-03/api-spec.md §4.2. Added
// post-review (PR #80) to close the gap the queue's Owner filter
// (ui-spec.md §9) and Ticket Detail's Ticket Owner select (ui-spec.md §10)
// hit against GET /api/users (§6.1, Administrator-only): an IT Staff caller
// needs a way to list the active IT Staff/Administrator users BR-19 allows
// as a Ticket Owner.
//
// This file deliberately does NOT assert an exact full-list equality
// against seed.ts's fixture Users the way staff-queue.api.test.ts can for
// Tickets. reset-db.ts truncates Ticket/Attachment/TicketCounter/Session
// before every test but never User (staff-queue.api.test.ts's own header
// comment explains why that's safe for reused seeded fixtures) — and
// several other lab-03 test files (auth.api.test.ts, authorization.api.
// test.ts, comments-notes.api.test.ts) create their own test-local Users
// that they clean up in their own afterEach, but a still-running test in
// this same process could observe a transient row from another file if
// ever run non-serially. `vitest.config.ts`'s `fileParallelism: false`
// makes that a non-issue in practice, but every assertion below is written
// to hold even in the presence of arbitrary OTHER active IT_STAFF/
// ADMINISTRATOR/REQUESTER rows: filtering/ordering/shape checks use
// `toContainEqual`/`not.toContainEqual`/relative-index comparisons against
// this file's own test-local fixtures (cleaned up in `afterEach`, following
// authorization.api.test.ts's `createdUserIds` pattern) rather than a fixed
// array length or exact seed-only equality.

const testServer = useTestServer(app);

const DEFAULT_PASSWORD = 'CorrectHorseBattery1';

let createdUserIds: number[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds = [];
  }
});

async function createUser(name: string, role: Role, isActive: boolean): Promise<{ id: number; email: string }> {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const email = `assignable-test-${role.toLowerCase()}-${Math.random().toString(36).slice(2)}-${Date.now()}@example.edu`;

  const user = await prisma.user.create({
    data: { name, email, role, isActive, passwordHash, mustChangePassword: false },
  });
  createdUserIds.push(user.id);
  return { id: user.id, email };
}

function extractSessionCookiePair(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!raw) {
    throw new Error('Response carried no toktickit.sid cookie');
  }
  return raw.split(';')[0];
}

async function loginAndGetCookie(email: string, password: string = LOCAL_DEV_PASSWORD): Promise<string> {
  const res = await request(testServer.server)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password });
  expect(res.status, 'test fixture login must succeed').toBe(200);
  return extractSessionCookiePair(res);
}

function getAssignableUsers(cookie: string | undefined) {
  const req = request(testServer.server).get('/api/staff/assignable-users');
  return cookie === undefined ? req : req.set('Cookie', cookie);
}

type AssignableUser = { id: number; name: string; role: Role };

async function getStaffCookie(): Promise<string> {
  const staff = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'IT_STAFF' } });
  return loginAndGetCookie(staff.email);
}

describe('GET /api/staff/assignable-users', () => {
  // -------------------------------------------------------------------
  // Auth — api-spec.md §4.2: "IT Staff only. Requester -> 403."
  // -------------------------------------------------------------------
  describe('auth', () => {
    it('401 UNAUTHENTICATED with no session cookie', async () => {
      const res = await getAssignableUsers(undefined);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('401 UNAUTHENTICATED with an unknown/garbage session cookie', async () => {
      const res = await getAssignableUsers(`${SESSION_COOKIE_NAME}=does-not-exist`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('403 FORBIDDEN for a Requester, before any lookup', async () => {
      const requester = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'REQUESTER' } });
      const cookie = await loginAndGetCookie(requester.email);

      const res = await getAssignableUsers(cookie);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(Array.isArray(res.body)).toBe(false);
    });

    it('403 FORBIDDEN for an Administrator, before any lookup', async () => {
      const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });
      const cookie = await loginAndGetCookie(admin.email);

      const res = await getAssignableUsers(cookie);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(Array.isArray(res.body)).toBe(false);
    });

    it('200 for IT Staff', async () => {
      const cookie = await getStaffCookie();

      const res = await getAssignableUsers(cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // Response shape — §4.2: exactly {id, name, role}, no email/isActive/
  // mustChangePassword/passwordHash.
  // -------------------------------------------------------------------
  it('a returned entry carries exactly {id, name, role} — no email, isActive, mustChangePassword or passwordHash', async () => {
    const cookie = await getStaffCookie();
    const staffUser = await createUser('Zzz Shape Test User', 'IT_STAFF', true);

    const res = await getAssignableUsers(cookie);

    expect(res.status).toBe(200);
    const item = (res.body as AssignableUser[]).find((u) => u.id === staffUser.id);
    expect(item).toBeDefined();
    expect(item).toEqual({ id: staffUser.id, name: 'Zzz Shape Test User', role: 'IT_STAFF' });
    expect(Object.keys(item!).sort()).toEqual(['id', 'name', 'role']);
  });

  // -------------------------------------------------------------------
  // Active-only filtering — inactive IT Staff/Administrator excluded.
  // -------------------------------------------------------------------
  it('excludes an inactive IT Staff user', async () => {
    const cookie = await getStaffCookie();
    const inactiveStaff = await createUser('Aaa Inactive Staff Test', 'IT_STAFF', false);

    const res = await getAssignableUsers(cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as AssignableUser[]).map((u) => u.id);
    expect(ids).not.toContain(inactiveStaff.id);
  });

  it('excludes an inactive Administrator user', async () => {
    const cookie = await getStaffCookie();
    const inactiveAdmin = await createUser('Aaa Inactive Admin Test', 'ADMINISTRATOR', false);

    const res = await getAssignableUsers(cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as AssignableUser[]).map((u) => u.id);
    expect(ids).not.toContain(inactiveAdmin.id);
  });

  // -------------------------------------------------------------------
  // Role filtering — both IT_STAFF and ADMINISTRATOR included, REQUESTER
  // excluded, regardless of active status.
  // -------------------------------------------------------------------
  it('includes active IT_STAFF and ADMINISTRATOR users, excludes an active REQUESTER', async () => {
    const cookie = await getStaffCookie();
    const activeStaff = await createUser('Mmm Active Staff Test', 'IT_STAFF', true);
    const activeAdmin = await createUser('Mmm Active Admin Test', 'ADMINISTRATOR', true);
    const activeRequester = await createUser('Mmm Active Requester Test', 'REQUESTER', true);

    const res = await getAssignableUsers(cookie);

    expect(res.status).toBe(200);
    const items = res.body as AssignableUser[];
    expect(items).toContainEqual({ id: activeStaff.id, name: 'Mmm Active Staff Test', role: 'IT_STAFF' });
    expect(items).toContainEqual({ id: activeAdmin.id, name: 'Mmm Active Admin Test', role: 'ADMINISTRATOR' });
    expect(items.map((u) => u.id)).not.toContain(activeRequester.id);
  });

  it('excludes an inactive REQUESTER too (belt-and-braces: role filter already excludes every REQUESTER)', async () => {
    const cookie = await getStaffCookie();
    const inactiveRequester = await createUser('Aaa Inactive Requester Test', 'REQUESTER', false);

    const res = await getAssignableUsers(cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as AssignableUser[]).map((u) => u.id);
    expect(ids).not.toContain(inactiveRequester.id);
  });

  // -------------------------------------------------------------------
  // Ordering — name ascending.
  // -------------------------------------------------------------------
  it('orders by name ascending, spanning both eligible roles', async () => {
    const cookie = await getStaffCookie();
    // Distinctive prefixes guarantee these three sort strictly amongst
    // themselves regardless of any other active IT_STAFF/ADMINISTRATOR rows
    // present (seeded or from another file).
    const first = await createUser('Zqx_Order_1 Alpha', 'IT_STAFF', true);
    const second = await createUser('Zqx_Order_2 Bravo', 'ADMINISTRATOR', true);
    const third = await createUser('Zqx_Order_3 Charlie', 'IT_STAFF', true);

    const res = await getAssignableUsers(cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as AssignableUser[]).map((u) => u.id);
    const iFirst = ids.indexOf(first.id);
    const iSecond = ids.indexOf(second.id);
    const iThird = ids.indexOf(third.id);
    expect(iFirst).toBeGreaterThanOrEqual(0);
    expect(iSecond).toBeGreaterThan(iFirst);
    expect(iThird).toBeGreaterThan(iSecond);
  });
});
