import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { validateLoginEmail, validateLoginPassword } from '../validation/authFields.ts';
import { isSameAsCurrentPassword, validatePasswordLength } from '../validation/passwordPolicy.ts';
import {
  SESSION_TTL_MS,
  clearSessionCookie,
  generateSessionToken,
  hashSessionToken,
  setSessionCookie,
} from '../lib/session.ts';
import { isRateLimited, recordFailedAttempt } from '../lib/loginRateLimiter.ts';
import { authenticate, passwordChangeGate } from '../middleware/authContext.ts';
import type { FieldError } from '../validation/ticketFields.ts';

// POST /api/auth/login — api-spec.md §2.1 (BR-01, BR-06, BR-08, BR-38,
// BR-41; AC-01, AC-05, AC-13, AC-61, AC-62).
// POST /api/auth/logout — api-spec.md §2.2 (BR-10; AC-10).
// GET /api/auth/me — api-spec.md §2.3 (BR-39; AC-13, AC-59, AC-60).
// POST /api/auth/change-password — api-spec.md §2.4 (BR-02, BR-07, BR-41,
// BR-42; AC-02, AC-07, AC-08, AC-09, AC-64, AC-69, AC-70).
export const authRouter: Router = Router();

// Precomputed once, bcrypt cost 12, of a fixed placeholder string — compared
// against on every login where the email doesn't resolve to a real user, so
// an unknown-email login takes the same time as a known-email one (BR-08,
// api-spec.md §2.1: "No timing branch that would distinguish them: an
// unknown email still runs a bcrypt comparison against a dummy hash").
// Hardcoded rather than hashed at process startup, so boot never pays a
// bcrypt hash and the constant is identical across restarts/instances. Not a
// real credential for any account — it verifies against nothing.
const DUMMY_PASSWORD_HASH = '$2b$12$nHmsmjdRC8B50LqvYit12.Z/9ww3VE.hdmeKwdkNW92Dh1DYCQoki';

function isPlainRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

function malformedBody(res: Response): void {
  res.status(400).json({
    error: 'MALFORMED_BODY',
    message: 'Request body must be a JSON object.',
  });
}

function validationFailed(res: Response, fields: FieldError[]): void {
  res.status(400).json({
    error: 'VALIDATION_FAILED',
    message: 'One or more fields are invalid.',
    fields,
  });
}

// BR-08: byte-identical for wrong password, unknown email and inactive
// account.
function invalidCredentials(res: Response): void {
  res.status(401).json({
    error: 'INVALID_CREDENTIALS',
    message: "We couldn't sign you in. Check your email and password and try again.",
  });
}

// BR-38: same body as invalidCredentials apart from the error code.
function rateLimited(res: Response): void {
  res.status(429).json({
    error: 'RATE_LIMITED',
    message: "We couldn't sign you in. Check your email and password and try again.",
  });
}

function internalError(res: Response): void {
  res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
}

/**
 * BR-40 (api-spec.md §1.6): every state-changing endpoint requires
 * `Content-Type: application/json`, else `415`.
 *
 * Scope note: mounted only on this router's own POST routes, not globally
 * in app.ts. Retrofitting it onto the existing Lab 2 ticket/attachment
 * routes would change already-tested behavior there (they currently answer
 * a missing/wrong Content-Type with `400 MALFORMED_BODY` via
 * `isPlainRequestBody`, exercised by server/tests/lab-02/*.test.ts) — that
 * migration is a deliberate judgment call left to whichever issue re-points
 * those routes onto session auth (#69/#70), not silently done here.
 */
function requireJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    res.status(415).json({
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Content-Type must be application/json.',
    });
    return;
  }
  next();
}

interface UserResponseSource {
  id: number;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
}

/** Shared 200/201-style user body (api-spec.md §2.1, §2.3) — never includes `passwordHash` (BR-06, AC-13). */
function userResponseBody(user: UserResponseSource) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

// ---------------------------------------------------------------------------
// POST /api/auth/login (api-spec.md §2.1)
// ---------------------------------------------------------------------------

authRouter.post('/login', requireJsonContentType, async (req: Request, res: Response) => {
  if (!isPlainRequestBody(req.body)) {
    malformedBody(res);
    return;
  }

  const emailResult = validateLoginEmail(req.body.email);
  const passwordResult = validateLoginPassword(req.body.password);

  const fieldErrors: FieldError[] = [
    ...(emailResult.ok ? [] : [emailResult.error]),
    ...(passwordResult.ok ? [] : [passwordResult.error]),
  ];
  if (fieldErrors.length > 0) {
    validationFailed(res, fieldErrors);
    return;
  }

  const email = (emailResult as Extract<typeof emailResult, { ok: true }>).value;
  const password = (passwordResult as Extract<typeof passwordResult, { ok: true }>).value;

  // BR-38: checked before any credential work — a key already at the limit
  // never even reaches the bcrypt comparison below.
  const emailKey = `email:${email}`;
  const ipKey = `ip:${req.ip ?? 'unknown'}`;
  if (isRateLimited(emailKey) || isRateLimited(ipKey)) {
    rateLimited(res);
    return;
  }

  try {
    // email is not a Prisma @unique field (schema.prisma's case-insensitive
    // index has no declarative representation — see the comment there and
    // specification.md §7.4 item 6), so this is findFirst, not findUnique,
    // matching prisma/seed.ts's own lookup.
    const user = await prisma.user.findFirst({ where: { email } });

    // BR-08: always exactly one bcrypt comparison, against the real hash if
    // the user exists (active or not) or a fixed dummy hash if they don't —
    // so an unknown email, a wrong password, and an inactive account all
    // take the same time and branch on the same line below.
    const hashToCompare = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await verifyPassword(password, hashToCompare);

    if (!user || !user.isActive || !passwordMatches) {
      recordFailedAttempt(emailKey);
      recordFailedAttempt(ipKey);
      invalidCredentials(res);
      return;
    }

    // BR-41: a new session row is always created; an existing one is never
    // reused.
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    await prisma.session.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    setSessionCookie(req, res, token);
    res.status(200).json(userResponseBody(user));
  } catch (error) {
    console.error('Error during login:', error);
    internalError(res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout (api-spec.md §2.2)
// ---------------------------------------------------------------------------

authRouter.post('/logout', requireJsonContentType, authenticate, async (req: Request, res: Response) => {
  try {
    // BR-10: the session row is deleted, not merely expired, so a
    // subsequent request with the same cookie is 401 (authenticate() will
    // no longer find a matching row).
    await prisma.session.delete({ where: { tokenHash: req.sessionTokenHash! } }).catch(() => {});
    clearSessionCookie(req, res);
    res.status(204).send();
  } catch (error) {
    console.error('Error during logout:', error);
    internalError(res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me (api-spec.md §2.3)
// ---------------------------------------------------------------------------

authRouter.get('/me', authenticate, passwordChangeGate, (req: Request, res: Response) => {
  // req.authUser was loaded fresh from the User row by authenticate() on
  // THIS request (BR-39) — no separate re-read needed here.
  res.status(200).json(userResponseBody(req.authUser!));
});

// ---------------------------------------------------------------------------
// POST /api/auth/change-password (api-spec.md §2.4)
// ---------------------------------------------------------------------------

authRouter.post(
  '/change-password',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  async (req: Request, res: Response) => {
    if (!isPlainRequestBody(req.body)) {
      malformedBody(res);
      return;
    }

    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: req.authUser!.id },
        select: { passwordHash: true, mustChangePassword: true },
      });
      if (!dbUser) {
        // authenticate() just confirmed this user exists and is active;
        // this would only happen from a concurrent deletion, which this
        // codebase never performs (BR-33: users are deactivated, never
        // deleted) — kept as a defensive branch rather than a non-null
        // assertion.
        internalError(res);
        return;
      }

      // The two paths are distinguished by the caller's CURRENT flag, not
      // by a request body field (api-spec.md §2.4).
      const forced = dbUser.mustChangePassword;
      const fieldErrors: FieldError[] = [];

      // BR-42: forced path forbids currentPassword outright; voluntary path
      // requires it.
      if (forced && Object.prototype.hasOwnProperty.call(req.body, 'currentPassword')) {
        fieldErrors.push({
          field: 'currentPassword',
          message: 'currentPassword is not accepted for a forced password change.',
        });
      }
      if (!forced && (typeof req.body.currentPassword !== 'string' || req.body.currentPassword.length === 0)) {
        fieldErrors.push({ field: 'currentPassword', message: 'currentPassword is required.' });
      }

      const newPasswordResult = validatePasswordLength(req.body.newPassword, 'newPassword');
      if (!newPasswordResult.ok) {
        fieldErrors.push(newPasswordResult.error);
      }

      if (typeof req.body.confirmPassword !== 'string' || req.body.confirmPassword.length === 0) {
        fieldErrors.push({ field: 'confirmPassword', message: 'confirmPassword is required.' });
      } else if (newPasswordResult.ok && req.body.confirmPassword !== newPasswordResult.value) {
        fieldErrors.push({ field: 'confirmPassword', message: 'confirmPassword must match newPassword.' });
      }

      if (fieldErrors.length > 0) {
        validationFailed(res, fieldErrors);
        return;
      }

      // Guaranteed ok: fieldErrors is empty, and the only way
      // newPasswordResult could be !ok is by pushing onto fieldErrors above.
      const newPassword = (newPasswordResult as Extract<typeof newPasswordResult, { ok: true }>).value;

      // BR-42: verified before any change is made; wrong -> 403, unchanged.
      if (!forced) {
        const currentPassword = req.body.currentPassword as string;
        const currentMatches = await verifyPassword(currentPassword, dbUser.passwordHash);
        if (!currentMatches) {
          res.status(403).json({ error: 'WRONG_PASSWORD', message: 'Current password is incorrect.' });
          return;
        }
      }

      // BR-07: new password must differ from the one it replaces, on both
      // paths.
      const sameAsCurrent = await isSameAsCurrentPassword(newPassword, dbUser.passwordHash);
      if (sameAsCurrent) {
        validationFailed(res, [
          { field: 'newPassword', message: 'New password must be different from your current password.' },
        ]);
        return;
      }

      const newHash = await hashPassword(newPassword);

      await prisma.$transaction([
        prisma.user.update({
          where: { id: req.authUser!.id },
          data: { passwordHash: newHash, mustChangePassword: false },
        }),
        // BR-41, AC-64: every OTHER session for this user is deleted; the
        // calling session (this exact tokenHash) survives.
        prisma.session.deleteMany({
          where: { userId: req.authUser!.id, tokenHash: { not: req.sessionTokenHash! } },
        }),
      ]);

      res.status(204).send();
    } catch (error) {
      console.error('Error changing password:', error);
      internalError(res);
    }
  },
);
