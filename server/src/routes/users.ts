import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, passwordChangeGate, requireRole } from '../middleware/authContext.ts';
import { parseAdminUsersQuery, ADMIN_USER_ROLES, type AdminUserRole } from '../validation/adminUsersQuery.ts';
import { validateLoginEmail } from '../validation/authFields.ts';
import { validatePasswordLength } from '../validation/passwordPolicy.ts';
import { hashPassword } from '../lib/password.ts';
import type { FieldError } from '../validation/ticketFields.ts';
import { prisma } from '../lib/prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import { PrismaClientKnownRequestError } from '../generated/prisma/internal/prismaNamespace.ts';

// GET /api/users — api-spec.md §6.1 (FR-28, FR-35; AC-45, AC-46, AC-47,
// AC-55). Administrator-only user list, with optional search and role
// filter.
//
// POST /api/users, PATCH /api/users/:id and POST /api/users/:id/
// initial-password (§6.2-6.4) are this same dispatch's addition — see each
// route's own section below.
export const usersRouter: Router = Router();

// Postgres int4 max — User.id is int4. Mirrors `tickets.ts`'s own
// `PG_INT4_MAX`/`parseTicketIdParam` pair; not imported from there because
// that constant is module-private to `tickets.ts` (not exported), and this
// router has no other dependency on that file.
const PG_INT4_MAX = 2_147_483_647;

/**
 * Shape-validates the `:id` path param for `PATCH /api/users/:id` and
 * `POST /api/users/:id/initial-password`. Same reasoning as
 * `tickets.ts`'s `parseTicketIdParam`: a non-integer or out-of-int4-range id
 * can't reference any row, so it is a 404 (the route matched, the resource
 * did not) — never a 400, and never allowed to reach a raw DB query where an
 * out-of-range value would raise a driver-level error instead of a clean
 * "not found" (see server/tests/lab-03/ticket-owner.api.test.ts's own int4
 * overflow regression test for the class of bug this guards against).
 */
function parseUserIdParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > PG_INT4_MAX) {
    return null;
  }
  return id;
}

function isPlainRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

function malformedBody(res: Response): void {
  res.status(400).json({
    error: 'MALFORMED_BODY',
    message: 'Request body must be a JSON object.',
  });
}

function invalidQuery(res: Response, fields: FieldError[]): void {
  res.status(400).json({
    error: 'INVALID_QUERY',
    message: 'One or more query parameters are invalid.',
    fields,
  });
}

function validationFailed(res: Response, fields: FieldError[]): void {
  res.status(400).json({
    error: 'VALIDATION_FAILED',
    message: 'One or more fields are invalid.',
    fields,
  });
}

function notFound(res: Response): void {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'User not found.',
  });
}

function emailInUse(res: Response): void {
  res.status(409).json({
    error: 'EMAIL_IN_USE',
    message: 'This email address is already in use.',
  });
}

function selfDeactivation(res: Response): void {
  res.status(409).json({
    error: 'SELF_DEACTIVATION',
    message: 'You cannot deactivate your own account.',
  });
}

function lastAdmin(res: Response): void {
  res.status(409).json({
    error: 'LAST_ADMIN',
    message: 'This change would leave no active Administrator.',
  });
}

function internalError(res: Response): void {
  res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
}

/**
 * BR-40 (api-spec.md §1.6): every state-changing endpoint requires
 * `Content-Type: application/json`, else `415`. Mounted first, ahead of
 * `authenticate` — same ordering `tickets.ts`'s own `requireJsonContentType`
 * uses on every one of its state-changing routes (BR-40's CSRF rationale
 * (D-04) is independent of session state, so the check runs before the
 * session is even resolved).
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

interface AdminUserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
}

/** Shared 200/201 user body (api-spec.md §6.1) — never includes `passwordHash` (BR-06, AC-13). */
function adminUserJson(user: AdminUserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}

const ADMIN_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  // passwordHash deliberately excluded — never returned (BR-06, AC-13).
} as const;

/** name: required, non-empty after trimming — same trim convention as `ticketFields.ts`'s free-text fields. */
function validateName(raw: unknown): FieldError | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { field: 'name', message: 'name is required.' };
  }
  return null;
}

/** role: required, exactly one of the three permitted enum values (BR-27, AC-50). */
function validateRoleShape(raw: unknown): FieldError | null {
  if (typeof raw !== 'string' || !(ADMIN_USER_ROLES as readonly string[]).includes(raw)) {
    return { field: 'role', message: 'role must be one of REQUESTER, IT_STAFF, ADMINISTRATOR.' };
  }
  return null;
}

/** isActive: required, boolean. */
function validateIsActiveShape(raw: unknown): FieldError | null {
  if (typeof raw !== 'boolean') {
    return { field: 'isActive', message: 'isActive must be a boolean.' };
  }
  return null;
}

/**
 * Case-insensitive duplicate-email lookup (BR-09, BR-29): `email` is
 * deliberately not a Prisma `@unique` field (see schema.prisma's comment on
 * it), so this is `findFirst` against the already-lower-cased value, same as
 * `auth.ts`'s login lookup. `excludeId`, when given, excludes that row's own
 * current email so a no-op update doesn't self-conflict.
 */
async function findUserByEmail(
  tx: Prisma.TransactionClient | typeof prisma,
  email: string,
  excludeId?: number,
): Promise<{ id: number } | null> {
  return tx.user.findFirst({
    where: { email, ...(excludeId !== undefined ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
}

/**
 * True for a Prisma unique-constraint violation (P2002) on the hand-written
 * `User_email_lower_key` index (schema.prisma's comment on `email`;
 * migration `20260914120000_evolve_user_model_roles_sessions`). Same
 * belt-and-braces pattern as `services/createTicket.ts`'s
 * `isTicketNumberCollision`: the `findUserByEmail` pre-check above closes
 * the ordinary window, this catches the residual race between that check
 * and the write for two concurrent creates/updates of the same email.
 */
function isEmailCollision(error: unknown): boolean {
  if (!(error instanceof PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.includes('email');
  }
  return typeof target === 'string' && target.includes('email');
}

// api-spec.md §6.2: create body accepts exactly `{ name, email, role,
// isActive, initialPassword }` — nothing else. `mustChangePassword` is
// listed here deliberately, not omitted: BR-30/AC-48 make it always `true`
// and never client-settable, so a body that tries to set it explicitly is
// rejected the same as any other field outside this allow-list, rather than
// silently ignored.
const CREATE_ALLOWED_FIELDS: ReadonlySet<string> = new Set(['name', 'email', 'role', 'isActive', 'initialPassword']);

// api-spec.md §6.3, BR-28: update body accepts any subset of exactly these
// four fields — "and nothing else".
const PATCH_ALLOWED_FIELDS: ReadonlySet<string> = new Set(['name', 'email', 'role', 'isActive']);

// api-spec.md §6.4: initial-password body accepts exactly `{ initialPassword }`.
const INITIAL_PASSWORD_ALLOWED_FIELDS: ReadonlySet<string> = new Set(['initialPassword']);

/**
 * One `VALIDATION_FAILED` field error per key in `body` that isn't in
 * `allowed` — covers both a known-but-forbidden field (e.g. `passwordHash`,
 * `mustChangePassword`, `id` on `PATCH /api/users/:id`, BR-28) and any other
 * unrecognized key, uniformly.
 */
function forbiddenFieldErrors(body: Record<string, unknown>, allowed: ReadonlySet<string>): FieldError[] {
  return Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => ({ field: key, message: `${key} is not an accepted field.` }));
}

// §6: "Every route in this section is Administrator-only. A Requester or IT
// Staff caller gets 403 FORBIDDEN before any lookup." Matches the same
// requireRole(...)-alone, before-any-lookup 403 convention `staff.ts` uses
// for its own IT-Staff-exclusive routes (§1.4 case 1).
usersRouter.get('/', authenticate, passwordChangeGate, requireRole('ADMINISTRATOR'), async (req: Request, res: Response) => {
  const parsed = parseAdminUsersQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    invalidQuery(res, parsed.errors);
    return;
  }

  const { search, role } = parsed.value;

  try {
    const where: Prisma.UserWhereInput = {
      // Case-insensitive substring match on name OR email — same pattern
      // `staff.ts`'s GET /tickets uses for its own search.
      ...(search !== undefined
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(role !== undefined ? { role } : {}),
    };

    const users = await prisma.user.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        // passwordHash deliberately excluded — never returned (BR-06, AC-13).
      },
    });

    res.status(200).json(users);
  } catch (error) {
    console.error('Error listing users:', error);
    internalError(res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users (api-spec.md §6.2)
// ---------------------------------------------------------------------------

usersRouter.post(
  '/',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  requireRole('ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    if (!isPlainRequestBody(req.body)) {
      malformedBody(res);
      return;
    }

    const body = req.body;
    const fieldErrors: FieldError[] = [...forbiddenFieldErrors(body, CREATE_ALLOWED_FIELDS)];

    const nameError = validateName(body.name);
    if (nameError) fieldErrors.push(nameError);

    // validateLoginEmail covers the shape rules (BR-01-adjacent) and
    // lower-cases the result (BR-09); the case-insensitive *duplicate*
    // check (EMAIL_IN_USE) is a separate, DB-backed step below — this
    // validator only ever judges shape.
    const emailResult = validateLoginEmail(body.email);
    if (!emailResult.ok) fieldErrors.push(emailResult.error);

    const roleError = validateRoleShape(body.role);
    if (roleError) fieldErrors.push(roleError);

    const isActiveError = validateIsActiveShape(body.isActive);
    if (isActiveError) fieldErrors.push(isActiveError);

    const passwordResult = validatePasswordLength(body.initialPassword, 'initialPassword');
    if (!passwordResult.ok) fieldErrors.push(passwordResult.error);

    if (fieldErrors.length > 0) {
      validationFailed(res, fieldErrors);
      return;
    }

    const name = (body.name as string).trim();
    const email = (emailResult as Extract<typeof emailResult, { ok: true }>).value;
    const role = body.role as AdminUserRole;
    const isActive = body.isActive as boolean;
    const initialPassword = (passwordResult as Extract<typeof passwordResult, { ok: true }>).value;

    try {
      const existing = await findUserByEmail(prisma, email);
      if (existing) {
        emailInUse(res);
        return;
      }

      const passwordHash = await hashPassword(initialPassword);
      const user = await prisma.user.create({
        data: {
          name,
          email,
          role,
          isActive,
          passwordHash,
          // BR-30, AC-48: always true on create, and not settable by the
          // client — the allow-list above already rejects a body that tries
          // to set this field itself, so there is no client value to ignore
          // here; this is simply the only value create ever writes.
          mustChangePassword: true,
        },
        select: ADMIN_USER_SELECT,
      });

      res.status(201).json(adminUserJson(user));
    } catch (error) {
      if (isEmailCollision(error)) {
        emailInUse(res);
        return;
      }
      console.error('Error creating user:', error);
      internalError(res);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/users/:id (api-spec.md §6.3)
// ---------------------------------------------------------------------------

type PatchOutcome =
  | { kind: 'not-found' }
  | { kind: 'email-in-use' }
  | { kind: 'self-deactivation' }
  | { kind: 'last-admin' }
  | { kind: 'ok'; user: AdminUserRow };

usersRouter.patch(
  '/:id',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  requireRole('ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    const userId = parseUserIdParam(String(req.params.id));
    if (userId === null) {
      notFound(res);
      return;
    }

    if (!isPlainRequestBody(req.body)) {
      malformedBody(res);
      return;
    }

    const body = req.body;
    const fieldErrors: FieldError[] = [...forbiddenFieldErrors(body, PATCH_ALLOWED_FIELDS)];

    let name: string | undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const nameError = validateName(body.name);
      if (nameError) {
        fieldErrors.push(nameError);
      } else {
        name = (body.name as string).trim();
      }
    }

    let email: string | undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      const emailResult = validateLoginEmail(body.email);
      if (!emailResult.ok) {
        fieldErrors.push(emailResult.error);
      } else {
        email = emailResult.value;
      }
    }

    let role: AdminUserRole | undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'role')) {
      const roleError = validateRoleShape(body.role);
      if (roleError) {
        fieldErrors.push(roleError);
      } else {
        role = body.role as AdminUserRole;
      }
    }

    let isActive: boolean | undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
      const isActiveError = validateIsActiveShape(body.isActive);
      if (isActiveError) {
        fieldErrors.push(isActiveError);
      } else {
        isActive = body.isActive as boolean;
      }
    }

    if (fieldErrors.length > 0) {
      validationFailed(res, fieldErrors);
      return;
    }

    try {
      // Every guard-rail below is evaluated inside this one transaction,
      // alongside the write itself, so two concurrent requests reading the
      // same "before" state can't both be judged safe and both commit
      // (api-spec.md §6.3: "evaluated inside the same transaction as the
      // write, so two concurrent demotions cannot both pass").
      const outcome: PatchOutcome = await prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({ where: { id: userId } });
        if (!current) {
          return { kind: 'not-found' };
        }

        if (email !== undefined) {
          const duplicate = await findUserByEmail(tx, email, userId);
          if (duplicate) {
            return { kind: 'email-in-use' };
          }
        }

        const resultingIsActive = isActive !== undefined ? isActive : current.isActive;
        const resultingRole = role !== undefined ? role : current.role;

        // BR-31, AC-53: the caller cannot deactivate their own account —
        // unconditional, regardless of how many other Administrators are
        // active. Checked before LAST_ADMIN below since it's the more
        // specific rule and must win whenever both would otherwise apply
        // (a sole active Administrator deactivating themselves is both a
        // self-deactivation and, mechanically, a last-admin change).
        if (userId === req.authUser!.id && resultingIsActive === false) {
          return { kind: 'self-deactivation' };
        }

        // BR-32, AC-54: no change may leave zero active Administrators,
        // "whether by deactivating the last one or by changing their role
        // away from ADMINISTRATOR" — both collapse to the same condition:
        // this row currently counts as an active Administrator and would
        // stop counting as one. The count of *other* active Administrators
        // (excluding :id itself) is what decides whether that's fatal — see
        // this route's own header note on why, in practice, the only way to
        // reach a count of zero here is a sole active Administrator
        // changing their OWN role away from ADMINISTRATOR (BR-31's second
        // sentence): self-deactivation is already caught above regardless
        // of count, and deactivating or demoting a *different* user can
        // never zero the count while the caller — who must themselves be an
        // active Administrator to reach this route at all — remains
        // unaffected by their own request.
        const wasActiveAdministrator = current.role === 'ADMINISTRATOR' && current.isActive;
        const staysActiveAdministrator = resultingRole === 'ADMINISTRATOR' && resultingIsActive;
        if (wasActiveAdministrator && !staysActiveAdministrator) {
          const otherActiveAdmins = await tx.user.count({
            where: { role: 'ADMINISTRATOR', isActive: true, id: { not: userId } },
          });
          if (otherActiveAdmins === 0) {
            return { kind: 'last-admin' };
          }
        }

        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(email !== undefined ? { email } : {}),
            ...(role !== undefined ? { role } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
          },
          select: ADMIN_USER_SELECT,
        });

        return { kind: 'ok', user: updated };
      });

      switch (outcome.kind) {
        case 'not-found':
          notFound(res);
          return;
        case 'email-in-use':
          emailInUse(res);
          return;
        case 'self-deactivation':
          selfDeactivation(res);
          return;
        case 'last-admin':
          lastAdmin(res);
          return;
        case 'ok':
          res.status(200).json(adminUserJson(outcome.user));
          return;
      }
    } catch (error) {
      if (isEmailCollision(error)) {
        emailInUse(res);
        return;
      }
      console.error('Error updating user:', error);
      internalError(res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/users/:id/initial-password (api-spec.md §6.4)
// ---------------------------------------------------------------------------

usersRouter.post(
  '/:id/initial-password',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  requireRole('ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    const userId = parseUserIdParam(String(req.params.id));
    if (userId === null) {
      notFound(res);
      return;
    }

    if (!isPlainRequestBody(req.body)) {
      malformedBody(res);
      return;
    }

    const body = req.body;
    const fieldErrors: FieldError[] = [...forbiddenFieldErrors(body, INITIAL_PASSWORD_ALLOWED_FIELDS)];

    const passwordResult = validatePasswordLength(body.initialPassword, 'initialPassword');
    if (!passwordResult.ok) fieldErrors.push(passwordResult.error);

    if (fieldErrors.length > 0) {
      validationFailed(res, fieldErrors);
      return;
    }

    const initialPassword = (passwordResult as Extract<typeof passwordResult, { ok: true }>).value;

    try {
      const passwordHash = await hashPassword(initialPassword);

      const found = await prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!current) {
          return false;
        }

        await tx.user.update({
          where: { id: userId },
          data: { passwordHash, mustChangePassword: true },
        });

        // api-spec.md §6.4, BR-41: EVERY session belonging to this user is
        // deleted — no exclusion clause. Unlike auth.ts's own change-password
        // handler (which excludes the caller's own session, because there
        // the caller and the account being changed are the same person),
        // the caller here is the Administrator, and `:id` is the account
        // being reset — a different person in the ordinary case, but even
        // if an Administrator resets their own account through this route,
        // BR-41 still deletes that session unconditionally: there is no
        // "current session" to preserve from this route's point of view.
        await tx.session.deleteMany({ where: { userId } });

        return true;
      });

      if (!found) {
        notFound(res);
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error setting initial password:', error);
      internalError(res);
    }
  },
);
