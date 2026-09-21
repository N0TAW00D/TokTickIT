import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME } from '../../src/lib/session.js';
import { LOCAL_DEV_PASSWORD } from '../../prisma/seedConstants.js';
import type { Role } from '../../src/generated/prisma/client.js';

// GET /api/users — docs/lab-03/api-spec.md §6.1 (specification.md FR-28,
// FR-35; AC-45, AC-46, AC-47, AC-55). Administrator-only user list with
// search and role filter.
//
// This `describe` block is scoped to GET /api/users ONLY — later dispatches
// add POST /api/users, PATCH /api/users/:id and
// POST /api/users/:id/initial-password (§6.2-6.4) to THIS SAME FILE, each in
// its own top-level `describe`, so this block's name must stay unambiguous.
//
// Like staff-assignable-users.api.test.ts, this file does not assert an
// exact full-list equality against seed.ts's fixture Users — reset-db.ts
// never truncates User between tests, and other lab-03 test files create
// their own test-local Users cleaned up in their own afterEach. Every
// assertion below holds in the presence of arbitrary other active/inactive
// REQUESTER/IT_STAFF/ADMINISTRATOR rows: filtering/ordering/shape checks use
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

async function createUser(
  name: string,
  email: string,
  role: Role,
  isActive: boolean = true,
): Promise<{ id: number; name: string; email: string; role: Role; isActive: boolean }> {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const user = await prisma.user.create({
    data: { name, email, role, isActive, passwordHash, mustChangePassword: false },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name, email, role, isActive };
}

function uniqueEmail(tag: string): string {
  return `users-admin-test-${tag}-${Math.random().toString(36).slice(2)}-${Date.now()}@example.edu`;
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

function getUsers(cookie: string | undefined, query: Record<string, string> = {}) {
  const req = request(testServer.server).get('/api/users').query(query);
  return cookie === undefined ? req : req.set('Cookie', cookie);
}

type AdminUser = { id: number; name: string; email: string; role: Role; isActive: boolean; mustChangePassword: boolean };

async function getAdminCookie(): Promise<string> {
  const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });
  return loginAndGetCookie(admin.email);
}

describe('GET /api/users (api-spec.md §6.1)', () => {
  // -------------------------------------------------------------------
  // Auth — §6: "Every route in this section is Administrator-only."
  // -------------------------------------------------------------------
  describe('auth', () => {
    it('401 UNAUTHENTICATED with no session cookie', async () => {
      const res = await getUsers(undefined);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('401 UNAUTHENTICATED with an unknown/garbage session cookie', async () => {
      const res = await getUsers(`${SESSION_COOKIE_NAME}=does-not-exist`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('403 FORBIDDEN for a Requester, before any lookup', async () => {
      const requester = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'REQUESTER' } });
      const cookie = await loginAndGetCookie(requester.email);

      const res = await getUsers(cookie);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(Array.isArray(res.body)).toBe(false);
    });

    it('403 FORBIDDEN for an IT Staff caller, before any lookup', async () => {
      const staff = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'IT_STAFF' } });
      const cookie = await loginAndGetCookie(staff.email);

      const res = await getUsers(cookie);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(Array.isArray(res.body)).toBe(false);
    });

    it('200 for an Administrator', async () => {
      const cookie = await getAdminCookie();

      const res = await getUsers(cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // Response shape — §6.1: exactly {id, name, email, role, isActive,
  // mustChangePassword}, never passwordHash (BR-06, AC-13).
  // -------------------------------------------------------------------
  it('a returned entry carries exactly {id, name, email, role, isActive, mustChangePassword} — no passwordHash', async () => {
    const cookie = await getAdminCookie();
    const user = await createUser('Zzz Shape Test User', uniqueEmail('shape'), 'REQUESTER', true);

    const res = await getUsers(cookie);

    expect(res.status).toBe(200);
    const item = (res.body as AdminUser[]).find((u) => u.id === user.id);
    expect(item).toBeDefined();
    expect(item).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'REQUESTER',
      isActive: true,
      mustChangePassword: false,
    });
    expect(Object.keys(item!).sort()).toEqual(['email', 'id', 'isActive', 'mustChangePassword', 'name', 'role']);
  });

  it('the response body never contains passwordHash for any entry', async () => {
    const cookie = await getAdminCookie();
    await createUser('Aaa PasswordHash Guard Test', uniqueEmail('pwhash'), 'REQUESTER', true);

    const res = await getUsers(cookie);

    expect(res.status).toBe(200);
    for (const item of res.body as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty('passwordHash');
    }
  });

  // -------------------------------------------------------------------
  // Full list, ordered by name ascending (AC-45).
  // -------------------------------------------------------------------
  it('lists users ordered by name ascending', async () => {
    const cookie = await getAdminCookie();
    const first = await createUser('Zqx_Order_1 Alpha', uniqueEmail('order1'), 'REQUESTER', true);
    const second = await createUser('Zqx_Order_2 Bravo', uniqueEmail('order2'), 'IT_STAFF', true);
    const third = await createUser('Zqx_Order_3 Charlie', uniqueEmail('order3'), 'ADMINISTRATOR', true);

    const res = await getUsers(cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as AdminUser[]).map((u) => u.id);
    const iFirst = ids.indexOf(first.id);
    const iSecond = ids.indexOf(second.id);
    const iThird = ids.indexOf(third.id);
    expect(iFirst).toBeGreaterThanOrEqual(0);
    expect(iSecond).toBeGreaterThan(iFirst);
    expect(iThird).toBeGreaterThan(iSecond);
  });

  // -------------------------------------------------------------------
  // Search — case-insensitive substring match on name OR email (AC-46).
  // -------------------------------------------------------------------
  describe('search', () => {
    it('matches by name (case-insensitive substring)', async () => {
      const cookie = await getAdminCookie();
      const target = await createUser('Zqx_Search_Name Unique Person', uniqueEmail('search-name'), 'REQUESTER', true);
      const other = await createUser('Zqx_Search_Name Other Person', uniqueEmail('search-name-other'), 'REQUESTER', true);

      const res = await getUsers(cookie, { search: 'unique person' });

      expect(res.status).toBe(200);
      const ids = (res.body as AdminUser[]).map((u) => u.id);
      expect(ids).toContain(target.id);
      expect(ids).not.toContain(other.id);
    });

    it('matches by email (case-insensitive substring)', async () => {
      const cookie = await getAdminCookie();
      const email = uniqueEmail('SearchByEmail');
      const target = await createUser('Zqx Search By Email Fixture', email, 'REQUESTER', true);

      const searchTerm = email.slice(0, 10).toUpperCase();
      const res = await getUsers(cookie, { search: searchTerm });

      expect(res.status).toBe(200);
      const ids = (res.body as AdminUser[]).map((u) => u.id);
      expect(ids).toContain(target.id);
    });

    it('returns [] when the search term matches neither name nor email', async () => {
      const cookie = await getAdminCookie();

      const res = await getUsers(cookie, { search: 'zzz-no-such-user-zqx-nonexistent-term-zzz' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Role filter — one of REQUESTER, IT_STAFF, ADMINISTRATOR (AC-47).
  // -------------------------------------------------------------------
  describe('role filter', () => {
    it('filters to REQUESTER only', async () => {
      const cookie = await getAdminCookie();
      const requester = await createUser('Zqx_Role_Req Person', uniqueEmail('role-req'), 'REQUESTER', true);
      const staff = await createUser('Zqx_Role_Req Staff Person', uniqueEmail('role-req-staff'), 'IT_STAFF', true);

      const res = await getUsers(cookie, { role: 'REQUESTER' });

      expect(res.status).toBe(200);
      const body = res.body as AdminUser[];
      expect(body.map((u) => u.id)).toContain(requester.id);
      expect(body.map((u) => u.id)).not.toContain(staff.id);
      expect(body.every((u) => u.role === 'REQUESTER')).toBe(true);
    });

    it('filters to IT_STAFF only', async () => {
      const cookie = await getAdminCookie();
      const staff = await createUser('Zqx_Role_Staff Person', uniqueEmail('role-staff'), 'IT_STAFF', true);
      const admin = await createUser('Zqx_Role_Staff Admin Person', uniqueEmail('role-staff-admin'), 'ADMINISTRATOR', true);

      const res = await getUsers(cookie, { role: 'IT_STAFF' });

      expect(res.status).toBe(200);
      const body = res.body as AdminUser[];
      expect(body.map((u) => u.id)).toContain(staff.id);
      expect(body.map((u) => u.id)).not.toContain(admin.id);
      expect(body.every((u) => u.role === 'IT_STAFF')).toBe(true);
    });

    it('filters to ADMINISTRATOR only', async () => {
      const cookie = await getAdminCookie();
      const admin = await createUser('Zqx_Role_Admin Person', uniqueEmail('role-admin'), 'ADMINISTRATOR', true);
      const requester = await createUser('Zqx_Role_Admin Req Person', uniqueEmail('role-admin-req'), 'REQUESTER', true);

      const res = await getUsers(cookie, { role: 'ADMINISTRATOR' });

      expect(res.status).toBe(200);
      const body = res.body as AdminUser[];
      expect(body.map((u) => u.id)).toContain(admin.id);
      expect(body.map((u) => u.id)).not.toContain(requester.id);
      expect(body.every((u) => u.role === 'ADMINISTRATOR')).toBe(true);
    });

    it('combines search and role filter together', async () => {
      const cookie = await getAdminCookie();
      const match = await createUser('Zqx_Combo_Match Person', uniqueEmail('combo-match'), 'IT_STAFF', true);
      const wrongRole = await createUser('Zqx_Combo_Match WrongRole Person', uniqueEmail('combo-wrong-role'), 'REQUESTER', true);

      const res = await getUsers(cookie, { search: 'Zqx_Combo_Match', role: 'IT_STAFF' });

      expect(res.status).toBe(200);
      const ids = (res.body as AdminUser[]).map((u) => u.id);
      expect(ids).toContain(match.id);
      expect(ids).not.toContain(wrongRole.id);
    });

    it('400 INVALID_QUERY for an invalid role value', async () => {
      const cookie = await getAdminCookie();

      const res = await getUsers(cookie, { role: 'SUPERADMIN' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_QUERY');
      expect(Array.isArray(res.body.fields)).toBe(true);
      expect(res.body.fields.some((f: { field: string }) => f.field === 'role')).toBe(true);
    });
  });
});
