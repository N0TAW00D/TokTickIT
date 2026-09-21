import { Router, type Request, type Response } from 'express';
import { authenticate, passwordChangeGate, requireRole } from '../middleware/authContext.ts';
import { parseAdminUsersQuery } from '../validation/adminUsersQuery.ts';
import type { FieldError } from '../validation/ticketFields.ts';
import { prisma } from '../lib/prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';

// GET /api/users — api-spec.md §6.1 (FR-28, FR-35; AC-45, AC-46, AC-47,
// AC-55). Administrator-only user list, with optional search and role
// filter. Create/update/initial-password (§6.2-6.4) are separate dispatches
// and deliberately not implemented here.
export const usersRouter: Router = Router();

function invalidQuery(res: Response, fields: FieldError[]): void {
  res.status(400).json({
    error: 'INVALID_QUERY',
    message: 'One or more query parameters are invalid.',
    fields,
  });
}

function internalError(res: Response): void {
  res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
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
