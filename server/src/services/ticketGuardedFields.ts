import { prisma } from '../lib/prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';
import { acquireTicketLock, type Tx } from './actionsTaken.ts';

// PATCH /api/tickets/:id/owner and /it-priority persistence (docs/lab-04/
// api-spec.md §3.3; specification.md BR-33, BR-34, D-07). Owner and IT
// Priority are guarded fields: one `$transaction` takes the Ticket row lock,
// reads, compares `version` (STALE_UPDATE carries the current Ticket), runs
// the route's own business check (INVALID_OWNER), then writes the field and
// increments `version`.

export type GuardedWriteResult<T> =
  | { kind: 'not-found' }
  | { kind: 'stale'; current: T }
  | { kind: 'rejected' }
  | { kind: 'updated'; ticket: T };

export async function updateGuardedTicketFields<T>(params: {
  ticketId: number;
  version: number;
  data: Prisma.TicketUncheckedUpdateInput;
  /** Business check run after the version compare; false -> `rejected`. */
  accept?: (tx: Tx) => Promise<boolean>;
  readTicket: (tx: Tx) => Promise<T>;
}): Promise<GuardedWriteResult<T>> {
  const { ticketId, version, data, accept, readTicket } = params;

  return prisma.$transaction(async (tx): Promise<GuardedWriteResult<T>> => {
    await acquireTicketLock(tx, ticketId, 'status');
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: { version: true } });
    if (!ticket) return { kind: 'not-found' };

    if (version !== ticket.version) return { kind: 'stale', current: await readTicket(tx) };

    if (accept && !(await accept(tx))) return { kind: 'rejected' };

    const { count } = await tx.ticket.updateMany({
      where: { id: ticketId, version: ticket.version },
      data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
    });
    if (count === 0) return { kind: 'stale', current: await readTicket(tx) };

    return { kind: 'updated', ticket: await readTicket(tx) };
  });
}
