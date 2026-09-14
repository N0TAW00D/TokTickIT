import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.ts';
import { hashSessionToken, readSessionCookie } from '../lib/session.ts';
import type { Role } from '../generated/prisma/client.ts';

// Session resolution and the password-change gate (api-spec.md §1.2, §1.5;
// BR-39, FR-06, AC-70). Mounted on every `/api/auth/*` route except login,
// which is deliberately public.
//
// Scope note for future issues (#69-#72): `authenticate` and
// `passwordChangeGate` are written to be reusable by any future router, not
// just this one — see `passwordChangeGate`'s doc comment. Issue #68 mounts
// them only on `/api/auth/*`; the ticket, staff-queue and admin-user routes
// stay on `requesterContext`/`X-Requester-Id` until #69/#70 rewire them onto
// real session auth, which is explicitly out of this issue's scope.

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
