// POST /api/tickets/:id/attachments — the storage-and-persistence half
// (api-spec.md §4.1; specification.md BR-14, BR-23, BR-27, BR-29).
//
// Owns the ownership check, the active-attachment-count limit, and the
// write-then-record ordering BR-27 requires. Field-shape/type/size
// validation (validation/attachmentFile.ts, multer's own size limit) and
// the X-Requester-Id resolution happen before this is ever called — the
// router (src/routes/tickets.ts) is what wires those together and maps the
// errors thrown here onto HTTP status codes.

import { prisma } from '../lib/prisma.ts';
import { deleteAttachmentFileBestEffort, storeAttachmentFile } from './attachmentStorage.ts';
import type { AllowedMimeType } from '../validation/attachmentFile.ts';

/** api-spec.md §4.1: "≤ 5 MB (`5 * 1024 * 1024` bytes)". */
export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

/** BR-23: "at most 5 active (non-removed) attachments" per ticket. */
export const MAX_ACTIVE_ATTACHMENTS_PER_TICKET = 5;

/**
 * Thrown when `ticketId` doesn't exist or isn't owned by `requesterId`.
 * The router maps this to `404 NOT_FOUND` (BR-14) — indistinguishable from
 * an unknown ticket id, by design.
 */
export class TicketNotFoundError extends Error {
  constructor() {
    super('Ticket not found or not owned by the caller');
    this.name = 'TicketNotFoundError';
  }
}

/**
 * Thrown when the ticket already has `MAX_ACTIVE_ATTACHMENTS_PER_TICKET`
 * non-removed attachments. The router maps this to `409 ATTACHMENT_LIMIT`
 * (BR-23, AC-20).
 */
export class AttachmentLimitError extends Error {
  constructor() {
    super(`Ticket already has ${MAX_ACTIVE_ATTACHMENTS_PER_TICKET} active attachments`);
    this.name = 'AttachmentLimitError';
  }
}

export interface UploadAttachmentInput {
  ticketId: number;
  requesterId: number;
  buffer: Buffer;
  mimeType: AllowedMimeType;
  extension: string;
  /** Already path-stripped and truncated (validation/attachmentFile.ts's `safeOriginalFilename`). */
  originalFilename: string;
}

/**
 * Verifies ownership and the active-attachment limit, then stores the file
 * and creates its metadata row.
 *
 * Ownership + a first-pass count both read from one `findUnique` so the
 * common case (a ticket nowhere near the limit) is rejected or accepted
 * without ever touching the filesystem or opening a transaction. That read
 * is a plain, unlocked count, though, so it cannot be the thing that
 * actually enforces BR-23: BR-23 is a server-side invariant on the
 * `Attachment` table ("at most 5 active"), not a promise about how any one
 * client behaves, and this endpoint is reachable by any caller, well-behaved
 * or not. So the real enforcement happens below, inside the transaction:
 * `SELECT ... FOR UPDATE` takes a row lock on the parent Ticket, and the
 * active count is re-read under that lock before the insert. Concurrent
 * uploads to the same near-full ticket serialize on the lock instead of
 * both observing room and both proceeding, so the table can never end up
 * above the limit no matter how many callers race.
 *
 * BR-27's ordering is structural: `storeAttachmentFile` is awaited (the
 * file is durably on disk) before the `Attachment` row is ever created. If
 * the transaction that creates the row (and bumps the ticket's `updatedAt`,
 * BR-07) then fails — including a late rejection from the locked recount
 * above — the just-written file is deleted on a best-effort basis
 * (`deleteAttachmentFileBestEffort`) and the original error propagates: an
 * `AttachmentLimitError` reaching the router still maps to `409
 * ATTACHMENT_LIMIT`, anything else to `500 INTERNAL`.
 */
export async function uploadAttachment(input: UploadAttachmentInput) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
    select: {
      id: true,
      requesterId: true,
      _count: { select: { attachments: { where: { isRemoved: false } } } },
    },
  });

  if (!ticket || ticket.requesterId !== input.requesterId) {
    throw new TicketNotFoundError();
  }
  if (ticket._count.attachments >= MAX_ACTIVE_ATTACHMENTS_PER_TICKET) {
    throw new AttachmentLimitError();
  }

  const { storedFilename } = await storeAttachmentFile(input.buffer, input.extension);

  try {
    const attachment = await prisma.$transaction(async (tx) => {
      // Row-lock the parent ticket so concurrent uploads to it serialize
      // here rather than racing: whichever transaction gets the lock first
      // recounts and inserts (or rejects) before the next one is even let
      // through `SELECT ... FOR UPDATE`. This is what actually makes BR-23
      // hold under concurrency — see the function doc above.
      await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${input.ticketId} FOR UPDATE`;

      const activeCount = await tx.attachment.count({
        where: { ticketId: input.ticketId, isRemoved: false },
      });
      if (activeCount >= MAX_ACTIVE_ATTACHMENTS_PER_TICKET) {
        throw new AttachmentLimitError();
      }

      const created = await tx.attachment.create({
        data: {
          ticketId: input.ticketId,
          originalFilename: input.originalFilename,
          storedFilename,
          mimeType: input.mimeType,
          fileSize: input.buffer.length,
        },
      });

      // BR-07: bump the parent ticket's `updatedAt` on any change to its
      // attachments. Same transaction as the row insert so the two effects
      // of one successful upload are atomic with each other.
      await tx.ticket.update({ where: { id: input.ticketId }, data: { updatedAt: new Date() } });

      return created;
    });

    return attachment;
  } catch (error) {
    await deleteAttachmentFileBestEffort(storedFilename);
    throw error;
  }
}
