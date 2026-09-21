import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import { useTestServer } from '../setup/http-server.js';
import { SESSION_COOKIE_NAME, hashSessionToken } from '../../src/lib/session.js';
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

// Postgres int4 max — User.id is int4. Same value `users.ts`'s own
// `PG_INT4_MAX` (and `tickets.ts`'s) uses; duplicated here the same way
// `ticket-owner.api.test.ts`'s own int4-overflow regression test duplicates
// it, rather than importing a route-module-private constant into a test.
const PG_INT4_MAX = 2_147_483_647;

// superagent's `.send()` only accepts a plain object/array when it will
// serialize the body itself (i.e. Content-Type is `application/json`, the
// default it applies); for any other Content-Type — used here only to
// exercise the 415 tests — it must be handed a raw string instead, same as
// `ticket-owner.api.test.ts`'s own 415 test (`.send('ownerId=1')`).
function sendableBody(body: unknown, contentType: string): string | object {
  return contentType === 'application/json' ? (body as object) : JSON.stringify(body);
}

function postCreateUser(cookie: string | undefined, body: unknown, contentType = 'application/json') {
  const req = request(testServer.server).post('/api/users').set('Content-Type', contentType);
  const sent = sendableBody(body, contentType);
  return cookie === undefined ? req.send(sent) : req.set('Cookie', cookie).send(sent);
}

function patchUser(id: number | string, cookie: string | undefined, body: unknown, contentType = 'application/json') {
  const req = request(testServer.server).patch(`/api/users/${id}`).set('Content-Type', contentType);
  const sent = sendableBody(body, contentType);
  return cookie === undefined ? req.send(sent) : req.set('Cookie', cookie).send(sent);
}

function postInitialPassword(id: number | string, cookie: string | undefined, body: unknown, contentType = 'application/json') {
  const req = request(testServer.server).post(`/api/users/${id}/initial-password`).set('Content-Type', contentType);
  const sent = sendableBody(body, contentType);
  return cookie === undefined ? req.send(sent) : req.set('Cookie', cookie).send(sent);
}

/**
 * Seeds a scenario with exactly one active Administrator (AC-54), so
 * LAST_ADMIN can be proven independently of SELF_DEACTIVATION (AC-53).
 * Deactivates every currently-active Administrator (the two seeded ones,
 * `Olivia Grant` and `Noah Kim`, plus any this file's other tests may have
 * left active — none should, but this is defensive rather than assuming),
 * creates one fresh test-local Administrator as the sole survivor, runs
 * `run` with it, then restores every deactivated row's `isActive` in a
 * `finally` — this file's tests run sequentially within the file
 * (`fileParallelism: false`, vitest.config.ts) and other test files never
 * touch `role: 'ADMINISTRATOR'` rows, so this is safe without a global lock,
 * but the restore must still happen even if `run` throws or an assertion
 * fails, or every later test in this file that logs in as a seeded
 * Administrator (`getAdminCookie`) would break.
 */
async function withSoleActiveAdministrator<T>(
  run: (soleAdmin: { id: number; email: string }) => Promise<T>,
): Promise<T> {
  const othersToDeactivate = await prisma.user.findMany({
    where: { role: 'ADMINISTRATOR', isActive: true },
    select: { id: true },
  });
  const soleAdmin = await createUser('Zqx_Sole_Admin', uniqueEmail('sole-admin'), 'ADMINISTRATOR', true);

  if (othersToDeactivate.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: othersToDeactivate.map((u) => u.id) } },
      data: { isActive: false },
    });
  }

  try {
    return await run(soleAdmin);
  } finally {
    if (othersToDeactivate.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: othersToDeactivate.map((u) => u.id) } },
        data: { isActive: true },
      });
    }
  }
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

// ---------------------------------------------------------------------------
// POST /api/users (api-spec.md §6.2)
// ---------------------------------------------------------------------------

describe('POST /api/users (api-spec.md §6.2)', () => {
  function validCreateBody(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Zqx Create Test User',
      email: uniqueEmail('create'),
      role: 'IT_STAFF',
      isActive: true,
      initialPassword: 'InitialPass1234',
      ...overrides,
    };
  }

  describe('auth', () => {
    it('401 UNAUTHENTICATED with no session cookie', async () => {
      const res = await postCreateUser(undefined, validCreateBody());
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('403 FORBIDDEN for a Requester, before any lookup', async () => {
      const requester = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'REQUESTER' } });
      const cookie = await loginAndGetCookie(requester.email);

      const res = await postCreateUser(cookie, validCreateBody());

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('403 FORBIDDEN for an IT Staff caller, before any lookup', async () => {
      const staff = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'IT_STAFF' } });
      const cookie = await loginAndGetCookie(staff.email);

      const res = await postCreateUser(cookie, validCreateBody());

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON content type', async () => {
      const cookie = await getAdminCookie();

      const res = await postCreateUser(cookie, validCreateBody(), 'text/plain');

      expect(res.status).toBe(415);
      expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  it("201 creates a user with mustChangePassword true, GET's shape, and the new user can log in (AC-48)", async () => {
    const cookie = await getAdminCookie();
    const email = uniqueEmail('happy');
    const body = validCreateBody({ name: 'Zqx Happy Create', email });

    const res = await postCreateUser(cookie, body);

    expect(res.status).toBe(201);
    createdUserIds.push(res.body.id);

    expect(res.body).toEqual({
      id: res.body.id,
      name: body.name,
      email,
      role: 'IT_STAFF',
      isActive: true,
      mustChangePassword: true,
    });
    expect(Object.keys(res.body).sort()).toEqual(['email', 'id', 'isActive', 'mustChangePassword', 'name', 'role']);

    const loginRes = await request(testServer.server)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password: body.initialPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.mustChangePassword).toBe(true);
  });

  it('stores the email lower-cased regardless of the case submitted (BR-09)', async () => {
    const cookie = await getAdminCookie();
    const mixedCaseEmail = uniqueEmail('MixedCase').replace('users-admin-test', 'Users-Admin-Test');

    const res = await postCreateUser(cookie, validCreateBody({ email: mixedCaseEmail }));

    expect(res.status).toBe(201);
    createdUserIds.push(res.body.id);
    expect(res.body.email).toBe(mixedCaseEmail.toLowerCase());
  });

  it('400 VALIDATION_FAILED for a missing name', async () => {
    const cookie = await getAdminCookie();

    const res = await postCreateUser(cookie, validCreateBody({ name: '' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'name')).toBe(true);
  });

  it('400 VALIDATION_FAILED for a malformed email', async () => {
    const cookie = await getAdminCookie();

    const res = await postCreateUser(cookie, validCreateBody({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'email')).toBe(true);
  });

  it('400 VALIDATION_FAILED for a role outside the three permitted values (AC-50)', async () => {
    const cookie = await getAdminCookie();

    const res = await postCreateUser(cookie, validCreateBody({ role: 'SUPERADMIN' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'role')).toBe(true);
  });

  it('400 VALIDATION_FAILED for an initialPassword shorter than 8 characters', async () => {
    const cookie = await getAdminCookie();

    const res = await postCreateUser(cookie, validCreateBody({ initialPassword: 'short1' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'initialPassword')).toBe(true);
  });

  it('400 VALIDATION_FAILED for an initialPassword longer than 128 characters', async () => {
    const cookie = await getAdminCookie();

    const res = await postCreateUser(cookie, validCreateBody({ initialPassword: 'a'.repeat(129) }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'initialPassword')).toBe(true);
  });

  it('400 VALIDATION_FAILED when the body carries mustChangePassword (not client-settable, BR-30)', async () => {
    const cookie = await getAdminCookie();

    const res = await postCreateUser(cookie, { ...validCreateBody(), mustChangePassword: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'mustChangePassword')).toBe(true);
  });

  it('409 EMAIL_IN_USE for a duplicate email compared case-insensitively (AC-49)', async () => {
    const cookie = await getAdminCookie();
    const existing = await createUser('Zqx Existing Email User', uniqueEmail('dup-existing'), 'REQUESTER', true);

    const res = await postCreateUser(cookie, validCreateBody({ email: existing.email.toUpperCase() }));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_IN_USE');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/users/:id (api-spec.md §6.3)
// ---------------------------------------------------------------------------

describe('PATCH /api/users/:id (api-spec.md §6.3)', () => {
  describe('auth', () => {
    it('401 UNAUTHENTICATED with no session cookie', async () => {
      const target = await createUser('Zqx Patch Auth Target', uniqueEmail('patch-auth'), 'REQUESTER', true);

      const res = await patchUser(target.id, undefined, { name: 'New Name' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('403 FORBIDDEN for a Requester, before any lookup', async () => {
      const requester = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'REQUESTER' } });
      const cookie = await loginAndGetCookie(requester.email);

      const res = await patchUser(9_999_999, cookie, { name: 'New Name' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('403 FORBIDDEN for an IT Staff caller, before any lookup', async () => {
      const staff = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'IT_STAFF' } });
      const cookie = await loginAndGetCookie(staff.email);

      const res = await patchUser(9_999_999, cookie, { name: 'New Name' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON content type', async () => {
      const cookie = await getAdminCookie();
      const target = await createUser('Zqx Patch 415 Target', uniqueEmail('patch-415'), 'REQUESTER', true);

      const res = await patchUser(target.id, cookie, { name: 'New Name' }, 'text/plain');

      expect(res.status).toBe(415);
      expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  it('200 updates name, email, role and activation state all at once (AC-51)', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx Patch All Fields', uniqueEmail('patch-all'), 'REQUESTER', true);
    const newEmail = uniqueEmail('patch-all-new');

    const res = await patchUser(target.id, cookie, {
      name: 'Zqx Patch All Fields Updated',
      email: newEmail,
      role: 'IT_STAFF',
      isActive: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: target.id,
      name: 'Zqx Patch All Fields Updated',
      email: newEmail,
      role: 'IT_STAFF',
      isActive: false,
      mustChangePassword: false,
    });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.name).toBe('Zqx Patch All Fields Updated');
    expect(stored.email).toBe(newEmail);
    expect(stored.role).toBe('IT_STAFF');
    expect(stored.isActive).toBe(false);
  });

  it('200 accepts a partial subset (name only), leaving other fields untouched', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx Patch Partial', uniqueEmail('patch-partial'), 'REQUESTER', true);

    const res = await patchUser(target.id, cookie, { name: 'Zqx Patch Partial Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Zqx Patch Partial Renamed');
    expect(res.body.email).toBe(target.email);
    expect(res.body.role).toBe('REQUESTER');
  });

  it('a no-op update of email to its own current value does not self-conflict', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx Patch Self Email', uniqueEmail('patch-self-email'), 'REQUESTER', true);

    const res = await patchUser(target.id, cookie, { email: target.email });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(target.email);
  });

  it('400 VALIDATION_FAILED for an invalid role value', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx Patch Bad Role', uniqueEmail('patch-bad-role'), 'REQUESTER', true);

    const res = await patchUser(target.id, cookie, { role: 'SUPERADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'role')).toBe(true);
  });

  it('400 VALIDATION_FAILED for a malformed email', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx Patch Bad Email', uniqueEmail('patch-bad-email'), 'REQUESTER', true);

    const res = await patchUser(target.id, cookie, { email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'email')).toBe(true);
  });

  it('400 VALIDATION_FAILED when the body carries passwordHash, id or mustChangePassword, with no partial write (BR-28, BR-34)', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx Patch Forbidden Fields', uniqueEmail('patch-forbidden'), 'REQUESTER', true);

    const res = await patchUser(target.id, cookie, {
      name: 'Still Not Allowed',
      passwordHash: 'evil-hash',
      id: 999,
      mustChangePassword: false,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    const fields = res.body.fields.map((f: { field: string }) => f.field);
    expect(fields).toContain('passwordHash');
    expect(fields).toContain('id');
    expect(fields).toContain('mustChangePassword');

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.name).toBe(target.name);
  });

  it('409 EMAIL_IN_USE for a duplicate email compared case-insensitively (AC-49)', async () => {
    const cookie = await getAdminCookie();
    const other = await createUser('Zqx Patch Dup Other', uniqueEmail('patch-dup-other'), 'REQUESTER', true);
    const target = await createUser('Zqx Patch Dup Target', uniqueEmail('patch-dup-target'), 'REQUESTER', true);

    const res = await patchUser(target.id, cookie, { email: other.email.toUpperCase() });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_IN_USE');
  });

  it('409 SELF_DEACTIVATION when an Administrator tries to deactivate their own account (AC-53)', async () => {
    // Deliberately NOT the sole-admin scenario below — seed.ts seeds 2
    // active Administrators, so this proves BR-31 is unconditional, not
    // merely a side effect of being the last one.
    const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });
    const cookie = await loginAndGetCookie(admin.email);

    const res = await patchUser(admin.id, cookie, { isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SELF_DEACTIVATION');

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.isActive).toBe(true);
  });

  it('an Administrator may still edit their own name (BR-31)', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'ADMINISTRATOR' } });
    const cookie = await loginAndGetCookie(admin.email);
    const originalName = admin.name;

    try {
      const res = await patchUser(admin.id, cookie, { name: 'Zqx Self Edit Name Temp' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Zqx Self Edit Name Temp');
    } finally {
      // Restore — this seeded Administrator is shared by every other test
      // in this file via getAdminCookie().
      await prisma.user.update({ where: { id: admin.id }, data: { name: originalName } });
    }
  });

  it('409 when deactivating the sole active Administrator would leave none (AC-54)', async () => {
    await withSoleActiveAdministrator(async (soleAdmin) => {
      const cookie = await loginAndGetCookie(soleAdmin.email, DEFAULT_PASSWORD);

      // Mechanically this is ALSO a self-deactivation — the only way a
      // deactivation can ever zero out active Administrators is deactivating
      // the sole one, since the caller of this route must themselves be an
      // active Administrator. Per this route's documented guard-rail order,
      // SELF_DEACTIVATION (the more specific rule) wins and is what actually
      // comes back. Either way this is a 409 rejection, which is what AC-54
      // requires ("any change... is rejected"); the LAST_ADMIN code itself is
      // proven independently by the role-change case below, which is not
      // also a self-deactivation.
      const res = await patchUser(soleAdmin.id, cookie, { isActive: false });

      expect(res.status).toBe(409);
      expect(['SELF_DEACTIVATION', 'LAST_ADMIN']).toContain(res.body.error);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: soleAdmin.id } });
      expect(stored.isActive).toBe(true);
    });
  });

  it("409 LAST_ADMIN when the sole active Administrator changes their own role away from ADMINISTRATOR (AC-54, BR-31)", async () => {
    await withSoleActiveAdministrator(async (soleAdmin) => {
      const cookie = await loginAndGetCookie(soleAdmin.email, DEFAULT_PASSWORD);

      const res = await patchUser(soleAdmin.id, cookie, { role: 'IT_STAFF' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('LAST_ADMIN');

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: soleAdmin.id } });
      expect(stored.role).toBe('ADMINISTRATOR');
    });
  });

  it('404 NOT_FOUND for a nonexistent :id', async () => {
    const cookie = await getAdminCookie();
    const bogusId = 999_999_999;

    const res = await patchUser(bogusId, cookie, { name: 'Does Not Matter' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('404 NOT_FOUND (never 500) when :id exceeds the int4 range', async () => {
    const cookie = await getAdminCookie();
    const outOfRangeId = PG_INT4_MAX + 1;

    const res = await patchUser(outOfRangeId, cookie, { name: 'Does Not Matter' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/initial-password (api-spec.md §6.4)
// ---------------------------------------------------------------------------

describe('POST /api/users/:id/initial-password (api-spec.md §6.4)', () => {
  const NEW_INITIAL_PASSWORD = 'ResetInitial1234';

  describe('auth', () => {
    it('401 UNAUTHENTICATED with no session cookie', async () => {
      const target = await createUser('Zqx InitPwd Auth Target', uniqueEmail('initpwd-auth'), 'REQUESTER', true);

      const res = await postInitialPassword(target.id, undefined, { initialPassword: NEW_INITIAL_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('403 FORBIDDEN for a Requester, before any lookup', async () => {
      const requester = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'REQUESTER' } });
      const cookie = await loginAndGetCookie(requester.email);

      const res = await postInitialPassword(9_999_999, cookie, { initialPassword: NEW_INITIAL_PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('403 FORBIDDEN for an IT Staff caller, before any lookup', async () => {
      const staff = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: 'IT_STAFF' } });
      const cookie = await loginAndGetCookie(staff.email);

      const res = await postInitialPassword(9_999_999, cookie, { initialPassword: NEW_INITIAL_PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('415 UNSUPPORTED_MEDIA_TYPE for a non-JSON content type', async () => {
      const cookie = await getAdminCookie();
      const target = await createUser('Zqx InitPwd 415 Target', uniqueEmail('initpwd-415'), 'REQUESTER', true);

      const res = await postInitialPassword(target.id, cookie, { initialPassword: NEW_INITIAL_PASSWORD }, 'text/plain');

      expect(res.status).toBe(415);
      expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  it('204 sets mustChangePassword true and deletes every existing session for that user (AC-52)', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx InitPwd Happy Target', uniqueEmail('initpwd-happy'), 'REQUESTER', true);

    // Seed an existing session for the target user directly — same pattern
    // as auth.api.test.ts's AC-11 test — so we can assert it's gone after.
    const priorToken = 'test-initial-password-prior-session-token';
    const priorTokenHash = hashSessionToken(priorToken);
    await prisma.session.create({
      data: { tokenHash: priorTokenHash, userId: target.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    const res = await postInitialPassword(target.id, cookie, { initialPassword: NEW_INITIAL_PASSWORD });

    expect(res.status).toBe(204);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.mustChangePassword).toBe(true);

    expect(await prisma.session.findUnique({ where: { tokenHash: priorTokenHash } })).toBeNull();

    // AC-52: the target user's next login lands on the forced
    // change-password screen, using the NEW password.
    const loginRes = await request(testServer.server)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: target.email, password: NEW_INITIAL_PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.mustChangePassword).toBe(true);
  });

  it('400 VALIDATION_FAILED for an initialPassword shorter than 8 characters', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx InitPwd Short', uniqueEmail('initpwd-short'), 'REQUESTER', true);

    const res = await postInitialPassword(target.id, cookie, { initialPassword: 'short1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'initialPassword')).toBe(true);
  });

  it('400 VALIDATION_FAILED for an initialPassword longer than 128 characters', async () => {
    const cookie = await getAdminCookie();
    const target = await createUser('Zqx InitPwd Long', uniqueEmail('initpwd-long'), 'REQUESTER', true);

    const res = await postInitialPassword(target.id, cookie, { initialPassword: 'a'.repeat(129) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.fields.some((f: { field: string }) => f.field === 'initialPassword')).toBe(true);
  });

  it('404 NOT_FOUND for a nonexistent :id', async () => {
    const cookie = await getAdminCookie();
    const bogusId = 999_999_999;

    const res = await postInitialPassword(bogusId, cookie, { initialPassword: NEW_INITIAL_PASSWORD });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('404 NOT_FOUND (never 500) when :id exceeds the int4 range', async () => {
    const cookie = await getAdminCookie();
    const outOfRangeId = PG_INT4_MAX + 1;

    const res = await postInitialPassword(outOfRangeId, cookie, { initialPassword: NEW_INITIAL_PASSWORD });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});
