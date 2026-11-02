import type { Prisma } from '../generated/prisma/client.ts';
import { windowStart } from './dashboardWindow.ts';

// One predicate per dashboard card, shared by the dashboard counts and the
// drill-down lists they open, so a card's number and the list total are the
// same query by construction (specification.md BR-31). Definitions are
// BR-21..BR-27.

/** BR-21: an Open Ticket is one whose status is not Resolved, Closed or Cancelled. */
export function openTicketWhere(): Prisma.TicketWhereInput {
  return { status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } };
}

/** BR-22: updated at or after the start of the Bangkok recent window. */
export function recentTicketWhere(now: Date): Prisma.TicketWhereInput {
  return { updatedAt: { gte: windowStart(now) } };
}

/**
 * BR-23: currently Resolved or Closed, and a status change into Resolved or
 * Closed happened inside the window. "Latest such change >= windowStart" is
 * the same as "some such change >= windowStart". `updatedAt` is never read
 * and a Ticket with no history never matches (D-10).
 */
export function recentlyResolvedTicketWhere(now: Date): Prisma.TicketWhereInput {
  return {
    status: { in: ['RESOLVED', 'CLOSED'] },
    statusChanges: {
      some: { toStatus: { in: ['RESOLVED', 'CLOSED'] }, changedAt: { gte: windowStart(now) } },
    },
  };
}

/** BR-25: a PLANNED / IN_PROGRESS Action that is the caller's to do. */
export function myOpenActionWhere(userId: number): Prisma.ActionTakenWhereInput {
  return {
    status: { in: ['PLANNED', 'IN_PROGRESS'] },
    OR: [{ assigneeId: userId }, { assigneeId: null, performedById: userId }],
    ticket: openTicketWhere(),
  };
}

/** Tickets having at least one of the caller's open Actions (BR-25). */
export function myActionsTicketWhere(userId: number): Prisma.TicketWhereInput {
  return { actionsTaken: { some: myOpenActionWhere(userId) } };
}

/** BR-26: an Open Ticket with at least one non-cancelled Action that needs a follow-up. */
export function followUpTicketWhere(): Prisma.TicketWhereInput {
  return {
    ...openTicketWhere(),
    actionsTaken: { some: { followUpRequired: true, status: { not: 'CANCELLED' } } },
  };
}

/** BR-27: Open and at the highest IT Priority. */
export function urgentTicketWhere(): Prisma.TicketWhereInput {
  return { ...openTicketWhere(), itPriority: 'HIGH' };
}
