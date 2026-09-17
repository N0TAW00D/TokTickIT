import { Router, type Request, type Response } from 'express';
import { authenticate, passwordChangeGate, requireRole } from '../middleware/authContext.ts';
import { parseStaffTicketQueueQuery, type OwnerFilter } from '../validation/staffTicketQueueQuery.ts';
import type { FieldError } from '../validation/ticketFields.ts';
import { prisma } from '../lib/prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';

// GET /api/staff/tickets — api-spec.md §4.1 (FR-19, BR-35, AC-26..AC-31,
// AC-33). The shared IT Staff queue across all Requesters.
export const staffRouter: Router = Router();

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

/** Translates the parsed `owner` filter into a `Ticket.ownerId` clause; `me` needs the caller's own id, which only the route has. */
function ownerWhere(owner: OwnerFilter, currentUserId: number): Prisma.TicketWhereInput {
  switch (owner.kind) {
    case 'unassigned':
      return { ownerId: null };
    case 'me':
      return { ownerId: currentUserId };
    case 'id':
      return { ownerId: owner.id };
  }
}

// §1.4 case 1: a role-gated collection the caller's role may never reach is
// `403` before any lookup. Unlike some other Lab 3 endpoints, this one is
// IT-Staff-exclusive — `requireRole('IT_STAFF')` alone means an
// Administrator gets the same before-any-lookup `403` a Requester does.
staffRouter.get('/tickets', authenticate, passwordChangeGate, requireRole('IT_STAFF'), async (req: Request, res: Response) => {
  const parsed = parseStaffTicketQueueQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    invalidQuery(res, parsed.errors);
    return;
  }

  const { search, status, itPriority, categoryId, owner, sort, direction, page, pageSize } = parsed.value;

  try {
    const where: Prisma.TicketWhereInput = {
      // Case-insensitive substring match on ticketNumber OR summary.
      ...(search !== undefined
        ? {
            OR: [
              { ticketNumber: { contains: search, mode: 'insensitive' as const } },
              { summary: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(status !== undefined ? { status } : {}),
      ...(itPriority !== undefined ? { itPriority } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(owner !== undefined ? ownerWhere(owner, req.authUser!.id) : {}),
    };

    // Default ordering is IT Priority descending, then created date
    // ascending (§4.1, D-10) — oldest most-urgent ticket first. `Priority`
    // is a native Postgres enum declared `LOW, MEDIUM, HIGH` (schema.prisma),
    // so Postgres already orders it by that declaration order rather than
    // alphabetically; a plain `ORDER BY "itPriority" DESC` yields
    // HIGH > MEDIUM > LOW, exactly the severity order §4.1 requires, with
    // no CASE expression needed. The secondary key breaks ties: `createdAt`
    // ascending when sorting by `itPriority` (matching the documented
    // default exactly), or `id` ascending for the other sort fields, for a
    // stable, deterministic page order across requests.
    const orderBy: Prisma.TicketOrderByWithRelationInput[] = [
      { [sort]: direction } as Prisma.TicketOrderByWithRelationInput,
      sort === 'itPriority' ? { createdAt: 'asc' } : { id: 'asc' },
    ];

    // A page past the last page, or a filter that matches nothing, is a
    // normal 200 with items: [] (§4.1) — Prisma's findMany simply returns no
    // rows for a skip beyond the result set, so no special-casing is needed.
    const [totalItems, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true } },
          // null when unassigned — the client renders the "Unassigned"
          // token from ui-spec.md §3.4 (§4.1).
          owner: { select: { id: true, name: true } },
        },
      }),
    ]);

    res.status(200).json({
      items: tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        summary: ticket.summary,
        category: ticket.category,
        requestedPriority: ticket.requestedPriority,
        itPriority: ticket.itPriority,
        status: ticket.status,
        owner: ticket.owner,
        requesterResolvedAt: ticket.requesterResolvedAt,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      })),
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    });
  } catch (error) {
    console.error('Error listing staff ticket queue:', error);
    internalError(res);
  }
});

// GET /api/staff/assignable-users — api-spec.md §4.2. Added post-review (PR
// #80): the queue's Owner filter (ui-spec.md §9) and Ticket Detail's Ticket
// Owner select (ui-spec.md §10) both need to list active IT Staff and
// Administrator users (BR-19: "an active IT Staff or Administrator user"),
// but GET /api/users (§6.1) is Administrator-only and gives an IT Staff
// caller 403. This route is the minimal, IT-Staff-callable alternative.
//
// Auth: "IT Staff only" per §4.2 — matching the same
// requireRole('IT_STAFF')-alone convention as /tickets above, an
// Administrator gets the same before-any-lookup 403 a Requester does (§4.2's
// parenthetical explains why they don't need this route — they have
// GET /api/users — not that they're specially admitted here).
staffRouter.get(
  '/assignable-users',
  authenticate,
  passwordChangeGate,
  requireRole('IT_STAFF'),
  async (_req: Request, res: Response) => {
    try {
      // Minimal shape by design (§4.2): no email, isActive or
      // mustChangePassword — those belong to §6.1's Administrator-only view.
      const users = await prisma.user.findMany({
        where: { isActive: true, role: { in: ['IT_STAFF', 'ADMINISTRATOR'] } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, role: true },
      });

      res.status(200).json(users);
    } catch (error) {
      console.error('Error listing assignable users:', error);
      internalError(res);
    }
  }
);
