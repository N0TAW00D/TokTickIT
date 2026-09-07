import { prisma } from '../lib/prisma.ts';
import { PrismaClientKnownRequestError } from '../generated/prisma/internal/prismaNamespace.ts';
import { allocateTicketNumber } from './ticketNumber.ts';
import type { Priority } from '../validation/ticketFields.ts';

// Ticket creation transaction (api-spec.md §3.1; specification.md BR-01,
// BR-02, BR-12, BR-24, BR-25, BR-26, BR-28, BR-36).
//
// This module owns exactly the part of POST /api/tickets that must be
// transactional: checking the Category/RelatedSystem references are active,
// allocating the Ticket Number, and inserting the Ticket row, all inside one
// `prisma.$transaction`. Field-shape validation (summary/description/
// priority via `validateTicketFields`) and the X-Requester-Id resolution
// (via `requesterContext`) happen before this is ever called — slice 8c's
// router (`../routes/tickets.ts`) is what wires those together.

/**
 * Thrown when `categoryId` or `relatedSystemId` does not reference an
 * active row. The router maps this to `404 NOT_FOUND` (BR-36, AC-43).
 *
 * Deliberately thrown *inside* the transaction: Prisma aborts (rolls back)
 * the transaction when the callback throws, so the "nothing persisted"
 * guarantee (BR-25/BR-26) holds even though the failure is discovered
 * mid-transaction, not before it opens.
 */
export class ReferenceNotFoundError extends Error {
  field: 'categoryId' | 'relatedSystemId';

  constructor(field: 'categoryId' | 'relatedSystemId') {
    super(`${field} does not reference an active row`);
    this.name = 'ReferenceNotFoundError';
    this.field = field;
  }
}

/**
 * Thrown when Ticket Number allocation still collides with the `ticketNumber`
 * unique constraint after every retry. The router maps this to `500
 * INTERNAL` (api-spec.md §3.1, BR-28). In practice `allocateTicketNumber`'s
 * atomic per-year counter (8b) should make this unreachable — the retry is a
 * documented backstop against the unique constraint, not the primary
 * concurrency control.
 */
export class TicketNumberCollisionError extends Error {
  constructor(attempts: number, options?: ErrorOptions) {
    super(`Ticket number allocation still collided after ${attempts} attempts`, options);
    this.name = 'TicketNumberCollisionError';
  }
}

export interface CreateTicketInput {
  requesterId: number;
  categoryId: number;
  relatedSystemId: number;
  requestedPriority: Priority;
  summary: string;
  description: string;
}

const MAX_ATTEMPTS = 3;

// Exported so `GET /api/tickets/:id` (api-spec.md §3.3) can build the exact
// same header shape as this endpoint's `201` body, plus its own `attachments`
// — rather than re-declaring an equivalent-but-separate `include` that could
// silently drift from this one.
export const TICKET_INCLUDE = {
  requester: { select: { id: true, name: true, email: true } },
  category: { select: { id: true, name: true } },
  relatedSystem: { select: { id: true, name: true } },
} as const;

/** True for a Prisma unique-constraint violation (P2002) on `ticketNumber`. */
function isTicketNumberCollision(error: unknown): boolean {
  if (!(error instanceof PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.includes('ticketNumber');
  }
  // Some drivers report the constraint name as a string instead of a
  // column-name array; the unique index Prisma generates for a `@unique`
  // field is named after it, so a substring match still identifies it.
  return typeof target === 'string' && target.includes('ticketNumber');
}

/**
 * Creates one Ticket for `input.requesterId`, allocating its Ticket Number
 * and validating its Category/RelatedSystem references inside a single
 * transaction (BR-01, BR-12, BR-28, BR-36).
 *
 * Throws `ReferenceNotFoundError` if `categoryId` or `relatedSystemId` is
 * unknown or inactive, or `TicketNumberCollisionError` if the `ticketNumber`
 * unique constraint still collides after 3 attempts. Any other error
 * (e.g. a lost database connection) propagates as-is — the router treats
 * every unmapped error as `500 INTERNAL`.
 */
export async function createTicket(input: CreateTicketInput) {
  let lastCollision: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        // Sequential, not Promise.all: a `$transaction` callback with the pg
        // driver adapter runs on one dedicated connection, so two queries
        // issued concurrently on the same `tx` race for it rather than
        // running in parallel (observable as a
        // "client.query() already executing" warning) — award each query
        // its own turn instead.
        const category = await tx.category.findUnique({ where: { id: input.categoryId } });
        const relatedSystem = await tx.relatedSystem.findUnique({ where: { id: input.relatedSystemId } });

        if (!category || !category.isActive) {
          throw new ReferenceNotFoundError('categoryId');
        }
        if (!relatedSystem || !relatedSystem.isActive) {
          throw new ReferenceNotFoundError('relatedSystemId');
        }

        const ticketNumber = await allocateTicketNumber(tx);

        // Deliberately no `include` here: fetching the nested
        // requester/category/relatedSystem is a read-only enrichment the
        // caller needs for the 201 body, not something that has to be part
        // of the write transaction. Prisma's query engine resolves an
        // `include` on `create` as multiple follow-up SELECTs, which inside
        // an interactive transaction are forced onto that transaction's one
        // pinned connection and fire concurrently on it (a "client.query()
        // already executing" warning from `pg`, and a latent footgun). Doing
        // the enriched read below, after commit, lets the pool hand out
        // separate connections for it instead.
        return tx.ticket.create({
          data: {
            ticketNumber,
            requesterId: input.requesterId,
            categoryId: input.categoryId,
            relatedSystemId: input.relatedSystemId,
            requestedPriority: input.requestedPriority,
            summary: input.summary,
            description: input.description,
            status: 'NEW',
          },
        });
      });

      return await prisma.ticket.findUniqueOrThrow({
        where: { id: created.id },
        include: TICKET_INCLUDE,
      });
    } catch (error) {
      // Reference failures are terminal — retrying can't make an inactive
      // or unknown row active, so surface immediately rather than burning
      // the 3 attempts BR-28 reserves for ticketNumber collisions.
      if (error instanceof ReferenceNotFoundError) {
        throw error;
      }
      if (isTicketNumberCollision(error)) {
        lastCollision = error;
        continue;
      }
      throw error;
    }
  }

  throw new TicketNumberCollisionError(MAX_ATTEMPTS, { cause: lastCollision });
}
