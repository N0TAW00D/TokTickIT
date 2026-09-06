// DELETE /api/attachments/:id — the soft-removal half (api-spec.md §4.4;
// specification.md BR-07, BR-31, BR-32, A-08).
//
// Field validation (validation/attachmentRemoval.ts) and the caller's
// identity (requesterContext) happen before this is ever called — the
// router (src/routes/attachments.ts) wires those together and maps the
// errors thrown here onto HTTP status codes.

import { prisma } from '../lib/prisma.ts';
import { AttachmentNotFoundError, getOwnedAttachment } from './attachmentAccess.ts';

export { AttachmentNotFoundError };

/**
 * Thrown when the attachment is already soft-removed. The router maps this
 * to `409 ALREADY_REMOVED` (BR-32).
 */
export class AttachmentAlreadyRemovedError extends Error {
  constructor() {
    super('Attachment is already removed');
    this.name = 'AttachmentAlreadyRemovedError';
  }
}

export interface RemoveAttachmentInput {
  attachmentId: number;
  /** The caller — also BR-31's `removedById` (only the owner may remove). */
  requesterId: number;
  /** Already validated: trimmed, 3-200 chars (validation/attachmentRemoval.ts). */
  reason: string;
}

/**
 * Verifies ownership (BR-14, via `getOwnedAttachment`), then atomically
 * transitions the attachment from active to removed and bumps the parent
 * ticket's `updatedAt` (BR-07) in one transaction.
 *
 * The active -> removed transition is a single conditional `UPDATE ...
 * WHERE id = ? AND "isRemoved" = false` (`updateMany` below), not a
 * read-then-check-then-write: that statement is one indivisible operation
 * in Postgres, so of two genuinely concurrent `DELETE`s on the same
 * attachment, exactly one can ever match the `isRemoved: false` predicate
 * and flip the row. There is no gap between checking `isRemoved` and
 * writing it for a second racing request to slip through — unlike a plain
 * `findUnique` + `update`, which lets both requests observe `isRemoved ===
 * false` and both write, silently overwriting the first remover's
 * `removedReason`/`removedById` (BR-31) and never raising BR-32's `409`.
 * The loser sees `count === 0` and throws `AttachmentAlreadyRemovedError`;
 * the router maps that to `409 ALREADY_REMOVED`.
 *
 * Everything runs inside one `$transaction` callback so a failure at any
 * step (the update, the ticket bump, or the read-back) rolls back the
 * whole thing rather than leaving a removed attachment with a stale ticket
 * or a lost write. The read-back deliberately happens *inside* this same
 * transaction rather than after it commits: Postgres always shows a
 * transaction its own uncommitted writes regardless of isolation level, so
 * reading here is a safe, consistent way to get the row exactly as this
 * request left it, with no window after commit where a later write could
 * be observed instead (there can't be one that changes these fields again,
 * but the guarantee comes for free by reading inside the transaction).
 *
 * The row and file are never deleted (A-08, BR-31): this only ever calls
 * `prisma.attachment.updateMany` (and `findUniqueOrThrow` to read it back).
 */
export async function removeAttachment(input: RemoveAttachmentInput) {
  // Throws AttachmentNotFoundError if the id is unknown or the ticket isn't
  // owned by this caller — identical whichever it is (BR-14, BR-42). This
  // happens before the transaction, and before the 409 check below, so an
  // unowned id is always 404, never 409 (BR-14/BR-42: a 409 would leak that
  // the attachment exists).
  const attachment = await getOwnedAttachment(input.attachmentId, input.requesterId);

  return prisma.$transaction(async (tx) => {
    const result = await tx.attachment.updateMany({
      where: { id: input.attachmentId, isRemoved: false },
      data: {
        isRemoved: true,
        removedAt: new Date(),
        removedReason: input.reason,
        removedById: input.requesterId,
      },
    });

    if (result.count === 0) {
      throw new AttachmentAlreadyRemovedError();
    }

    // BR-07: bump the parent ticket's updatedAt on any change to its
    // attachments, atomically with the removal itself.
    await tx.ticket.update({ where: { id: attachment.ticketId }, data: { updatedAt: new Date() } });

    return tx.attachment.findUniqueOrThrow({ where: { id: input.attachmentId } });
  });
}
