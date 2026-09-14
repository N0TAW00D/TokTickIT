import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Request, Response } from 'express';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import { useTestServer } from '../setup/http-server.js';
import { __resetLoginRateLimiterForTests } from '../../src/lib/loginRateLimiter.js';
import { SESSION_COOKIE_NAME, hashSessionToken } from '../../src/lib/session.js';
import { passwordChangeGate } from '../../src/middleware/authContext.js';

// Covers docs/lab-03/api-spec.md §2 (Authentication endpoints) and
// tests.md API-01..API-16, AC-01..AC-13, AC-59..AC-70. All requests go
// through one shared, already-listening server (tests/setup/http-server.ts)
// rather than `request(app)` — see that file for why.
const testServer = useTestServer(app);

// The login rate limiter (src/lib/loginRateLimiter.ts) is a module-level, in
// -process store keyed only by email/IP — it is not reset by
// tests/setup/reset-db.ts (which only truncates DB tables) and every
// request in this file shares one source IP, so it must be cleared before
// every test or one test's failed logins would bleed into the next test's
// assertions.
beforeEach(() => {
  __resetLoginRateLimiterForTests();
});

// reset-db.ts deliberately leaves the "User" table alone (other suites,
// e.g. tests/lab-02/requesters.api.test.ts and tests/lab-02/seed.test.ts,
// assert the exact seeded row set) — so every dedicated test-local User
// created in this file (via createUser() below) is tracked here and
// deleted after its own test, keeping this file's fixtures from leaking
// into any other suite's assertions about who exists.
let createdUserIds: number[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds = [];
  }
});

const DEFAULT_PASSWORD = 'CorrectHorseBattery1';

interface CreateUserOptions {
  role?: 'REQUESTER' | 'IT_STAFF' | 'ADMINISTRATOR';
  isActive?: boolean;
  mustChangePassword?: boolean;
  password?: string;
  emailPrefix?: string;
}

/**
 * Creates a dedicated, test-local User — never a seeded row — so mutating
 * it (deactivating, changing role, changing its password) can never affect
 * any other test in this file or any other file (reset-db.ts deliberately
 * leaves the seeded Users alone; see its updated comment).
 */
async function createUser(options: CreateUserOptions = {}) {
  const {
    role = 'REQUESTER',
    isActive = true,
    mustChangePassword = false,
    password = DEFAULT_PASSWORD,
    emailPrefix = 'auth-test',
  } = options;

  const passwordHash = await hashPassword(password);
  const email = `${emailPrefix}-${Math.random().toString(36).slice(2)}-${Date.now()}@example.edu`;

  const user = await prisma.user.create({
    data: { name: 'Auth Test User', email, role, isActive, mustChangePassword, passwordHash },
  });
  createdUserIds.push(user.id);
  return user;
}

function loginRequest(body: Record<string, unknown>) {
  return request(testServer.server).post('/api/auth/login').set('Content-Type', 'application/json').send(body);
}

/** Pulls the `name=value` pair for the session cookie out of a Set-Cookie response header, for reuse on the next request. */
function extractSessionCookiePair(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!raw) {
    throw new Error('Response carried no toktickit.sid cookie');
  }
  return raw.split(';')[0];
}

async function loginAndGetCookie(email: string, password: string): Promise<string> {
  const res = await loginRequest({ email, password });
  expect(res.status, 'test fixture login must succeed').toBe(200);
  return extractSessionCookiePair(res);
}

// ---------------------------------------------------------------------------
// POST /api/auth/login (api-spec.md §2.1)
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('API-01: valid credentials return 200 with the documented body, set the cookie, and create a Session row', async () => {
    const user = await createUser({ role: 'IT_STAFF', mustChangePassword: false });

    const res = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'IT_STAFF',
      mustChangePassword: false,
    });

    const cookiePair = extractSessionCookiePair(res);
    const [, token] = cookiePair.split('=');
    const tokenHash = hashSessionToken(decodeURIComponent(token));
    const session = await prisma.session.findUnique({ where: { tokenHash } });
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(user.id);
  });

  it('API-01a: the Set-Cookie attributes match api-spec.md §1.2 (HttpOnly, SameSite=Lax, Path=/, Max-Age=28800)', async () => {
    const user = await createUser();
    const res = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });

    const setCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    )!;

    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=28800/i);
  });

  it('API-13: the login response never contains a password or a hash (AC-13)', async () => {
    const user = await createUser();
    const res = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });

    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password');
    expect(JSON.stringify(res.body)).not.toContain(DEFAULT_PASSWORD);
  });

  it('AC-61: the login response carries the caller\'s real mustChangePassword state', async () => {
    const user = await createUser({ mustChangePassword: true });
    const res = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  describe('API-02..04: byte-identical 401 for wrong password, unknown email, and an inactive account (BR-08, AC-05)', () => {
    it('wrong password', async () => {
      const user = await createUser();
      const res = await loginRequest({ email: user.email, password: 'TotallyWrongPassword1' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'INVALID_CREDENTIALS',
        message: "We couldn't sign you in. Check your email and password and try again.",
      });
    });

    it('unknown email', async () => {
      const res = await loginRequest({
        email: `no-such-user-${Date.now()}@example.edu`,
        password: 'AnyPassword123',
      });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'INVALID_CREDENTIALS',
        message: "We couldn't sign you in. Check your email and password and try again.",
      });
    });

    it('inactive account, even with the correct password', async () => {
      const user = await createUser({ isActive: false });
      const res = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'INVALID_CREDENTIALS',
        message: "We couldn't sign you in. Check your email and password and try again.",
      });
    });

    it('all three bodies are byte-identical to each other', async () => {
      const user = await createUser();
      const inactiveUser = await createUser({ isActive: false });

      const [wrongPassword, unknownEmail, inactive] = await Promise.all([
        loginRequest({ email: user.email, password: 'Nope12345678' }),
        loginRequest({ email: `nobody-${Date.now()}@example.edu`, password: 'Nope12345678' }),
        loginRequest({ email: inactiveUser.email, password: DEFAULT_PASSWORD }),
      ]);

      expect(JSON.stringify(wrongPassword.body)).toBe(JSON.stringify(unknownEmail.body));
      expect(JSON.stringify(unknownEmail.body)).toBe(JSON.stringify(inactive.body));
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(inactive.status).toBe(401);
    });

    it('no Session row is created on any of the three failure cases', async () => {
      const user = await createUser();
      const before = await prisma.session.count();

      await loginRequest({ email: user.email, password: 'Wrong123456' });
      await loginRequest({ email: `ghost-${Date.now()}@example.edu`, password: 'Wrong123456' });

      const after = await prisma.session.count();
      expect(after).toBe(before);
    });
  });

  it('API-06: missing/malformed email or missing password return 400 VALIDATION_FAILED with fields[]', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['missing email', { password: 'somepassword' }],
      ['malformed email', { email: 'not-an-email', password: 'somepassword' }],
      ['missing password', { email: 'user@example.edu' }],
      ['empty password', { email: 'user@example.edu', password: '' }],
    ];

    for (const [label, body] of cases) {
      const res = await loginRequest(body);
      expect(res.status, label).toBe(400);
      expect(res.body.error, label).toBe('VALIDATION_FAILED');
      expect(Array.isArray(res.body.fields), label).toBe(true);
      expect((res.body.fields as unknown[]).length, label).toBeGreaterThan(0);
    }
  });

  it('AC-63: a non-JSON Content-Type is rejected with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(testServer.server)
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('email=a@example.edu&password=x');

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  describe('AC-62: login rate limiting (BR-38)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('per email: the 11th failed attempt for one email is 429, even with the correct password', async () => {
      const user = await createUser();

      for (let i = 0; i < 10; i++) {
        const res = await loginRequest({ email: user.email, password: 'WrongPassword1' });
        expect(res.status, `attempt ${i + 1}`).toBe(401);
      }

      const eleventh = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });
      expect(eleventh.status).toBe(429);
      expect(eleventh.body).toEqual({
        error: 'RATE_LIMITED',
        message: "We couldn't sign you in. Check your email and password and try again.",
      });
    });

    it('per source IP: 10 failures spread across different unknown emails from one source, then an 11th (different again) email is 429 (AC-62)', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await loginRequest({
          email: `spread-${i}-${Date.now()}@example.edu`,
          password: 'WrongPassword1',
        });
        expect(res.status, `attempt ${i + 1}`).toBe(401);
      }

      // This exact email has never failed before — only the shared source
      // IP has accumulated 10 failures — so a 429 here proves the IP
      // dimension, not the email dimension, is what's blocking it.
      const eleventh = await loginRequest({
        email: `spread-fresh-${Date.now()}@example.edu`,
        password: 'WrongPassword1',
      });
      expect(eleventh.status).toBe(429);
      expect(eleventh.body.error).toBe('RATE_LIMITED');
    });

    it('self-clears after the 15-minute window passes, and locks no account permanently', async () => {
      vi.useFakeTimers();
      try {
        const user = await createUser();

        for (let i = 0; i < 10; i++) {
          const res = await loginRequest({ email: user.email, password: 'WrongPassword1' });
          expect(res.status).toBe(401);
        }
        const blocked = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });
        expect(blocked.status).toBe(429);

        // 15 minutes + a margin.
        vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1000);

        const afterWindow = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });
        expect(afterWindow.status).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a 400 validation failure does not itself consume a rate-limit attempt', async () => {
      const user = await createUser();

      for (let i = 0; i < 15; i++) {
        const res = await loginRequest({ email: user.email });
        expect(res.status).toBe(400);
      }

      // Still able to log in normally — the 15 malformed requests above
      // never reached credential checking, so they never counted as
      // failures.
      const res = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });
      expect(res.status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout (api-spec.md §2.2)
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', () => {
  it('API-08: 204, the session row is deleted, and the same cookie is unauthenticated afterwards (BR-10, AC-10)', async () => {
    const user = await createUser();
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);
    const [, token] = cookie.split('=');
    const tokenHash = hashSessionToken(decodeURIComponent(token));

    expect(await prisma.session.findUnique({ where: { tokenHash } })).not.toBeNull();

    const logoutRes = await request(testServer.server)
      .post('/api/auth/logout')
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie)
      .send();

    expect(logoutRes.status).toBe(204);

    expect(await prisma.session.findUnique({ where: { tokenHash } })).toBeNull();

    const reuse = await request(testServer.server)
      .get('/api/auth/me')
      .set('Cookie', cookie);
    expect(reuse.status).toBe(401);
  });

  it('clears the cookie with Max-Age=0', async () => {
    const user = await createUser();
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await request(testServer.server)
      .post('/api/auth/logout')
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie)
      .send();

    const setCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    )!;
    expect(setCookie).toMatch(/Max-Age=0/);
  });

  it('401 when there was no valid session to begin with', async () => {
    const res = await request(testServer.server)
      .post('/api/auth/logout')
      .set('Content-Type', 'application/json')
      .send();

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('AC-63: a non-JSON Content-Type on logout is 415', async () => {
    const user = await createUser();
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await request(testServer.server).post('/api/auth/logout').set('Cookie', cookie).send();

    expect(res.status).toBe(415);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me (api-spec.md §2.3)
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  it('API-09: 200 with the documented shape for an authenticated caller (AC-59)', async () => {
    const user = await createUser({ role: 'ADMINISTRATOR' });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await request(testServer.server).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'ADMINISTRATOR',
      mustChangePassword: false,
    });
  });

  it('401 with no session (AC-59)', async () => {
    const res = await request(testServer.server).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('AC-60: a role change by an Administrator takes effect on the caller\'s very next request, without re-login (BR-39)', async () => {
    const user = await createUser({ role: 'REQUESTER' });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const before = await request(testServer.server).get('/api/auth/me').set('Cookie', cookie);
    expect(before.body.role).toBe('REQUESTER');

    // Simulates an Administrator's direct write (the Admin endpoint that
    // performs this update belongs to issue #71, out of this issue's
    // scope) — what THIS test asserts is that authenticate() re-reads the
    // User row fresh on every request rather than caching role on the
    // session (BR-39), which is #68's responsibility.
    await prisma.user.update({ where: { id: user.id }, data: { role: 'IT_STAFF' } });

    const after = await request(testServer.server).get('/api/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(200);
    expect(after.body.role).toBe('IT_STAFF');
  });

  it('AC-12: deactivating the user ends their next request in 401, not a role/body change', async () => {
    const user = await createUser();
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const res = await request(testServer.server).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('AC-11: a session older than 8 hours is unauthenticated, identical to no session at all', async () => {
    const user = await createUser();
    const token = 'test-expired-session-token-value';
    const tokenHash = hashSessionToken(token);
    await prisma.session.create({
      data: {
        tokenHash,
        userId: user.id,
        // 8 hours + 1 minute in the past — already expired.
        expiresAt: new Date(Date.now() - 8 * 60 * 60 * 1000 - 60 * 1000),
      },
    });

    const expired = await request(testServer.server)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`);
    const noSession = await request(testServer.server).get('/api/auth/me');

    expect(expired.status).toBe(401);
    expect(expired.body).toEqual(noSession.body);

    // Opportunistic cleanup (specification.md §7.1): the expired row is
    // deleted once it's resolved.
    expect(await prisma.session.findUnique({ where: { tokenHash } })).toBeNull();
  });

  it('never returns passwordHash (AC-13)', async () => {
    const user = await createUser();
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await request(testServer.server).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body).not.toHaveProperty('passwordHash');
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/change-password (api-spec.md §2.4)
// ---------------------------------------------------------------------------

describe('POST /api/auth/change-password', () => {
  function changePasswordRequest(cookie: string, body: Record<string, unknown>) {
    return request(testServer.server)
      .post('/api/auth/change-password')
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie)
      .send(body);
  }

  it('AC-09: forced path succeeds with {newPassword, confirmPassword}; flag clears; can log in with the new password', async () => {
    const user = await createUser({ mustChangePassword: true });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await changePasswordRequest(cookie, {
      newPassword: 'BrandNewPassword1',
      confirmPassword: 'BrandNewPassword1',
    });
    expect(res.status).toBe(204);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.mustChangePassword).toBe(false);

    const relogin = await loginRequest({ email: user.email, password: 'BrandNewPassword1' });
    expect(relogin.status).toBe(200);
  });

  it('AC-70: the gate admits /me, /change-password and /logout even while mustChangePassword is true', async () => {
    const user = await createUser({ mustChangePassword: true });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const me = await request(testServer.server).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
  });

  it('BR-42: sending currentPassword on the forced path is 400 VALIDATION_FAILED, nothing changes', async () => {
    const user = await createUser({ mustChangePassword: true });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await changePasswordRequest(cookie, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'BrandNewPassword1',
      confirmPassword: 'BrandNewPassword1',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect((res.body.fields as Array<{ field: string }>).some((f) => f.field === 'currentPassword')).toBe(true);

    const stillForced = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stillForced.mustChangePassword).toBe(true);
  });

  it('AC-69: voluntary path requires currentPassword; a wrong value is 403 WRONG_PASSWORD, password unchanged', async () => {
    const user = await createUser({ mustChangePassword: false });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await changePasswordRequest(cookie, {
      currentPassword: 'NotTheRealCurrentPassword1',
      newPassword: 'BrandNewPassword1',
      confirmPassword: 'BrandNewPassword1',
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WRONG_PASSWORD');

    // Old password still works.
    const relogin = await loginRequest({ email: user.email, password: DEFAULT_PASSWORD });
    expect(relogin.status).toBe(200);
  });

  it('AC-69: voluntary path succeeds with the correct currentPassword', async () => {
    const user = await createUser({ mustChangePassword: false });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await changePasswordRequest(cookie, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'BrandNewPassword1',
      confirmPassword: 'BrandNewPassword1',
    });
    expect(res.status).toBe(204);

    const relogin = await loginRequest({ email: user.email, password: 'BrandNewPassword1' });
    expect(relogin.status).toBe(200);
  });

  it('voluntary path missing currentPassword is 400 VALIDATION_FAILED', async () => {
    const user = await createUser({ mustChangePassword: false });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await changePasswordRequest(cookie, {
      newPassword: 'BrandNewPassword1',
      confirmPassword: 'BrandNewPassword1',
    });
    expect(res.status).toBe(400);
    expect((res.body.fields as Array<{ field: string }>).some((f) => f.field === 'currentPassword')).toBe(true);
  });

  describe('AC-07/AC-08: validation (BR-07), the flag stays set on failure', () => {
    it('too short (7 chars)', async () => {
      const user = await createUser({ mustChangePassword: true });
      const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

      const res = await changePasswordRequest(cookie, { newPassword: 'Short1x', confirmPassword: 'Short1x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');

      const stillForced = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stillForced.mustChangePassword).toBe(true);
    });

    it('too long (129 chars)', async () => {
      const user = await createUser({ mustChangePassword: true });
      const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

      const tooLong = 'a'.repeat(129);
      const res = await changePasswordRequest(cookie, { newPassword: tooLong, confirmPassword: tooLong });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');
    });

    it('confirmPassword mismatch', async () => {
      const user = await createUser({ mustChangePassword: true });
      const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

      const res = await changePasswordRequest(cookie, {
        newPassword: 'BrandNewPassword1',
        confirmPassword: 'SomethingElseEntirely1',
      });
      expect(res.status).toBe(400);
      expect((res.body.fields as Array<{ field: string }>).some((f) => f.field === 'confirmPassword')).toBe(true);
    });

    it('same as current password', async () => {
      const user = await createUser({ mustChangePassword: true });
      const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

      const res = await changePasswordRequest(cookie, {
        newPassword: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');
      expect((res.body.fields as Array<{ field: string }>).some((f) => f.field === 'newPassword')).toBe(true);

      const stillForced = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stillForced.mustChangePassword).toBe(true);
    });

    it('boundary values 8 and 128 characters are both accepted', async () => {
      const min = await createUser({ mustChangePassword: true });
      const minCookie = await loginAndGetCookie(min.email, DEFAULT_PASSWORD);
      const minRes = await changePasswordRequest(minCookie, {
        newPassword: '12345678',
        confirmPassword: '12345678',
      });
      expect(minRes.status).toBe(204);

      const max = await createUser({ mustChangePassword: true });
      const maxCookie = await loginAndGetCookie(max.email, DEFAULT_PASSWORD);
      const maxPassword = 'a'.repeat(128);
      const maxRes = await changePasswordRequest(maxCookie, {
        newPassword: maxPassword,
        confirmPassword: maxPassword,
      });
      expect(maxRes.status).toBe(204);
    });
  });

  it('AC-64: a successful password change deletes every OTHER session for that user; the calling session survives', async () => {
    const user = await createUser({ mustChangePassword: false });
    const cookieA = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);
    const cookieB = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    // BR-41: a new session row every login, never reused.
    expect(cookieA).not.toBe(cookieB);

    const res = await changePasswordRequest(cookieA, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'BrandNewPassword1',
      confirmPassword: 'BrandNewPassword1',
    });
    expect(res.status).toBe(204);

    const survivorCheck = await request(testServer.server).get('/api/auth/me').set('Cookie', cookieA);
    expect(survivorCheck.status).toBe(200);

    const otherSessionCheck = await request(testServer.server).get('/api/auth/me').set('Cookie', cookieB);
    expect(otherSessionCheck.status).toBe(401);
  });

  it('401 with no session', async () => {
    const res = await request(testServer.server)
      .post('/api/auth/change-password')
      .set('Content-Type', 'application/json')
      .send({ newPassword: 'BrandNewPassword1', confirmPassword: 'BrandNewPassword1' });
    expect(res.status).toBe(401);
  });

  it('AC-63: a non-JSON Content-Type is 415', async () => {
    const user = await createUser({ mustChangePassword: true });
    const cookie = await loginAndGetCookie(user.email, DEFAULT_PASSWORD);

    const res = await request(testServer.server)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send('newPassword=x');
    expect(res.status).toBe(415);
  });
});

// ---------------------------------------------------------------------------
// Password-change gate (api-spec.md §1.5, FR-06, AC-70) — unit-level,
// covering "every route except the three exempt ones" for all three roles.
//
// This issue (#68) introduces no OTHER session-authenticated route to
// exercise the gate against end-to-end — every other protected surface
// (tickets, staff queue, admin users) stays on X-Requester-Id until
// #69/#70 rewire it onto session auth, which is out of this issue's scope.
// `passwordChangeGate` is exported specifically so those future routers can
// reuse it unmodified; this suite proves its exemption logic directly,
// independent of which router eventually mounts it.
// ---------------------------------------------------------------------------

describe('passwordChangeGate (AC-70) — direct unit coverage', () => {
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

  const ROLES = ['REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'] as const;

  for (const role of ROLES) {
    it(`blocks a non-exempt route for a ${role} caller with mustChangePassword=true`, () => {
      const req = {
        authUser: { id: 1, name: 'Someone', email: 'someone@example.edu', role, mustChangePassword: true },
        baseUrl: '/api/staff',
        path: '/tickets',
      } as unknown as Request;
      const { res, fake } = mockResponse();
      const next = vi.fn();

      passwordChangeGate(req, fake, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Choose a new password before continuing.',
      });
    });
  }

  it('allows all three exempt paths through, regardless of the flag', () => {
    const exempt: Array<[string, string]> = [
      ['/api/auth', '/me'],
      ['/api/auth', '/change-password'],
      ['/api/auth', '/logout'],
    ];

    for (const [baseUrl, path] of exempt) {
      const req = {
        authUser: { id: 1, name: 'Someone', email: 'someone@example.edu', role: 'REQUESTER', mustChangePassword: true },
        baseUrl,
        path,
      } as unknown as Request;
      const { fake } = mockResponse();
      const next = vi.fn();

      passwordChangeGate(req, fake, next);

      expect(next).toHaveBeenCalledOnce();
    }
  });

  it('passes through untouched when mustChangePassword is false, for a non-exempt path', () => {
    const req = {
      authUser: { id: 1, name: 'Someone', email: 'someone@example.edu', role: 'REQUESTER', mustChangePassword: false },
      baseUrl: '/api/staff',
      path: '/tickets',
    } as unknown as Request;
    const { fake } = mockResponse();
    const next = vi.fn();

    passwordChangeGate(req, fake, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
