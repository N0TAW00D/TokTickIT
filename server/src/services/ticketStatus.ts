import { prisma } from '../lib/prisma.ts';
import { runHook } from '../lib/testHooks.ts';
import type { TicketStatus } from '../generated/prisma/client.ts';
import {
  evaluateClosingGate,
  evaluateResolutionGate,
  isTicketTransitionAllowed,
  type GateReason,
} from '../validation/ticketTransitions.ts';
import { acquireTicketLock, type Tx } from './actionsTaken.ts';

// PATCH /api/tickets/:id/status persistence (docs/lab-04/api-spec.md §1.3,
// §3.2; specification.md BR-16..BR-19, BR-33, BR-39..BR-41).
//
// One `$transaction`: Ticket row lock -> read -> compare `version` ->
// transition matrix -> OWNER_REQUIRED -> resolution / closing gate -> write
// (Ticket status + version, BR-41 cascade, exactly one history row). A
// rejected request leaves nothing behind.

export type StatusChangeResult<T> =
  | { kind: 'not-found' }
  | { kind: 'stale'; current: T }
  | { kind: 'invalid-transition' }
  | { kind: 'owner-required' }
  | { kind: 'resolution-blocked'; closing: boolean; reasons: GateReason[] }
  | { kind: 'updated'; ticket: T };

export async function changeTicketStatus<T>(params: {
  ticketId: number;
  actorId: number;
  requestedStatus: TicketStatus;
  version: number;
  /** Reads the response shape inside the transaction (keeps `current` consistent with the lock). */
  readTicket: (tx: Tx) => Promise<T>;
}): Promise<StatusChangeResult<T>> {
  const { ticketId, actorId, requestedStatus, version, readTicket } = params;

  return prisma.$transaction(async (tx): Promise<StatusChangeResult<T>> => {
    await acquireTicketLock(tx, ticketId, 'status');
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true, ownerId: true, version: true },
    });
    if (!ticket) return { kind: 'not-found' };

    if (version !== ticket.version) return { kind: 'stale', current: await readTicket(tx) };

    if (!isTicketTransitionAllowed(ticket.status, requestedStatus)) return { kind: 'invalid-transition' };

    // BR-24 (Lab 3): an owner is required to move to In Progress.
    if (requestedStatus === 'IN_PROGRESS' && ticket.ownerId === null) return { kind: 'owner-required' };

    if (requestedStatus === 'RESOLVED' || requestedStatus === 'CLOSED') {
      const actions = await tx.actionTaken.findMany({ where: { ticketId }, select: { status: true } });
      const statuses = actions.map((a) => a.status);
      const reasons =
        requestedStatus === 'RESOLVED'
          ? evaluateResolutionGate({ hasOwner: ticket.ownerId !== null, actionStatuses: statuses })
          : evaluateClosingGate(statuses);
      if (reasons.length > 0) return { kind: 'resolution-blocked', closing: requestedStatus === 'CLOSED', reasons };
    }

    const { count } = await tx.ticket.updateMany({
      where: { id: ticketId, version: ticket.version },
      data: { status: requestedStatus, version: { increment: 1 }, updatedAt: new Date() },
    });
    if (count === 0) return { kind: 'stale', current: await readTicket(tx) };

    if (requestedStatus === 'CANCELLED') {
      // BR-41: pending work on a Cancelled Ticket is moot; COMPLETED stays.
      await tx.actionTaken.updateMany({
        where: { ticketId, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
        data: { status: 'CANCELLED', lastUpdatedById: actorId, version: { increment: 1 }, updatedAt: new Date() },
      });
    }

    await tx.ticketStatusChange.create({
      data: { ticketId, fromStatus: ticket.status, toStatus: requestedStatus, changedById: actorId },
    });

    await runHook('before-commit', 'status');
    return { kind: 'updated', ticket: await readTicket(tx) };
  });
}
