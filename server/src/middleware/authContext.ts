import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.ts';
import { hashSessionToken, readSessionCookie } from '../lib/session.ts';
import type { Role } from '../generated/prisma/client.ts';

// Session resolution, the password-change gate, and role-based authorization
// (api-spec.md §1.2, §1.4, §1.5; BR-39, FR-06, FR-10, AC-70). Mounted on
// every `/api/auth/*` route except login, which is deliberately public.
//
// Scope note for future issues (#69-#73): `authenticate`, `passwordChangeGate`
// and `requireRole` are all written to be reusable by any future router, not
// just this one — see each function's own doc comment. Issue #68 mounted
// `authenticate`/`passwordChangeGate` only on `/api/auth/*`; issue #69 added
// `requireRole` here without mounting it anywhere new; issue #70 mounts all
// three, in this order, on `src/routes/tickets.ts` and
// `src/routes/attachments.ts` (deleting `requesterContext`/`X-Requester-Id`
// in the process). The staff-queue and admin-user routes still await #71/#73.

export interface AuthenticatedUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `authenticate` once the session cookie resolves to an active User. */
      authUser?: AuthenticatedUser;
      /** SHA-256 hex of the resolved session's raw token (BR-41: "every OTHER session" needs this to exclude the caller's own). */
      sessionTokenHash?: string;
    }
  }
}

function unauthenticated(res: Response): void {
  res.status(401).json({
    error: 'UNAUTHENTICATED',
    message: 'Sign in to continue.',
  });
}

/**
 * Resolves the session cookie into `req.authUser` (api-spec.md §1.2):
 * hash the cookie value -> look up `Session` -> reject if absent or
 * expired -> load the `User` row fresh and read `role`/`isActive`/
 * `mustChangePassword` from it, never from the session (BR-39), so an
 * Administrator's role change takes effect on the caller's very next
 * request without re-login.
 *
 * Expired session rows are deleted opportunistically when resolved
 * (specification.md §7.1). An inactive user's session rows should already
 * be gone (BR-12) — the `!user.isActive` branch is belt-and-braces for a row
 * that somehow survived that, per api-spec.md §1.2.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readSessionCookie(req);
  if (!token) {
    unauthenticated(res);
    return;
  }

  const tokenHash = hashSessionToken(token);

  try {
    const session = await prisma.session.findUnique({ where: { tokenHash } });
    if (!session) {
      unauthenticated(res);
      return;
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await prisma.session.delete({ where: { tokenHash } }).catch(() => {});
      unauthenticated(res);
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) {
      await prisma.session.delete({ where: { tokenHash } }).catch(() => {});
      unauthenticated(res);
      return;
    }

    req.authUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
    req.sessionTokenHash = tokenHash;
    next();
  } catch (error) {
    console.error('Error resolving session:', error);
    res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
  }
}

/**
 * Password-change gate (api-spec.md §1.5, FR-06, AC-70): while the caller's
 * `mustChangePassword` flag is set, every route except current-user,
 * change-password and logout is refused with `403
 * PASSWORD_CHANGE_REQUIRED`, regardless of role. Checked after
 * authentication, before any authorization check — always mount this
 * directly after `authenticate`.
 *
 * The exempt set is matched against the FULL mounted path (`req.baseUrl +
 * req.path`, which is stable regardless of query string), not the
 * router-relative path, so the same middleware instance can be reused by a
 * future router without re-deriving which of ITS routes are exempt — there
 * are none; only these three ever are.
 */
const GATE_EXEMPT_PATHS: ReadonlySet<string> = new Set(['/api/auth/me', '/api/auth/change-password', '/api/auth/logout']);

export function passwordChangeGate(req: Request, res: Response, next: NextFunction): void {
  const fullPath = req.baseUrl + req.path;
  if (req.authUser?.mustChangePassword && !GATE_EXEMPT_PATHS.has(fullPath)) {
    res.status(403).json({
      error: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Choose a new password before continuing.',
    });
    return;
  }
  next();
}

/**
 * Role-based authorization gate (issue #69; specification.md FR-10; §4.1's
 * matrix; api-spec.md §1.4 and §8's `FORBIDDEN` row). Always mount it
 * directly after `authenticate` and `passwordChangeGate`, in that order —
 * by the time this runs, `req.authUser` is expected to already be
 * populated and the caller already admitted through the password-change
 * gate, so this checks ONLY role membership:
 *
 *   router.get('/staff/tickets', authenticate, passwordChangeGate, requireRole('IT_STAFF'), handler)
 *
 * This implements exactly case 1 of the three-case `403`/`404` precedence
 * in specification.md §8.2 / api-spec.md §1.4: **"Role-gated collection the
 * caller's role may never reach -> `403` before any lookup. No record is
 * addressed, so nothing can leak."** A Requester calling
 * `GET /api/staff/tickets` is the worked example there — `requireRole` is
 * what answers that `403`, before the route handler ever runs a query.
 *
 * It deliberately does NOT attempt case 2 ("record-addressed, caller has no
 * read path -> `404`") or case 3 ("record-addressed, caller can read but
 * lacks this write -> `403`"). Both are resource-specific: whether a
 * Requester "owns" a given Ticket, or whether an Administrator "may read" a
 * given User, is domain logic that belongs next to the record lookup
 * itself, in whichever router actually queries that record (`GET
 * /api/tickets/:id` for #70, `PATCH /api/tickets/:id/status` for #71,
 * `GET/POST /api/users` for #73). A generic
 * `requireOwnerOr404(predicate)`-style helper was considered and rejected
 * here: with no real caller to write it against yet, it would be
 * unverifiable premature abstraction rather than tested code — see
 * server/tests/lab-03/authorization.api.test.ts's header comment for the
 * full reasoning. Build that helper, if one turns out to be honestly
 * shared, in the issue that has a first real record-addressed route to
 * prove it against.
 */
export function requireRole(...allowedRoles: Role[]) {
  const allowed = new Set<Role>(allowedRoles);
  return function requireRoleMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!req.authUser) {
      // Defensive only: requireRole is documented and tested to run after
      // `authenticate`, which always either populates `req.authUser` or
      // responds with 401 itself before calling `next()`. Reaching this
      // branch means some future router mounted requireRole out of order —
      // fail closed as unauthenticated rather than crash or fall through.
      unauthenticated(res);
      return;
    }

    if (!allowed.has(req.authUser.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      });
      return;
    }

    next();
  };
}
