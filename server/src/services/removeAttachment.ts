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
 * Verifies ownership (BR-14, via `getOwnedAttachment`) and that the
 * attachment isn't already removed (BR-32), then sets the soft-removal
 * fields and bumps the parent ticket's `updatedAt` (BR-07) in one
 * transaction — the same "one successful write, two effects, one
 * transaction" shape `uploadAttachment.ts` uses for BR-07 on the create
 * side.
 *
 * The row and file are never deleted (A-08, BR-31): this only ever calls
 * `prisma.attachment.update`.
 */
export async function removeAttachment(input: RemoveAttachmentInput) {
  // Throws AttachmentNotFoundError if the id is unknown or the ticket isn't
  // owned by this caller — identical whichever it is (BR-14, BR-42).
  const attachment = await getOwnedAttachment(input.attachmentId, input.requesterId);

  if (attachment.isRemoved) {
    throw new AttachmentAlreadyRemovedError();
  }

  const [updated] = await prisma.$transaction([
    prisma.attachment.update({
      where: { id: input.attachmentId },
      data: {
        isRemoved: true,
        removedAt: new Date(),
        removedReason: input.reason,
        removedById: input.requesterId,
      },
    }),
    // BR-07: bump the parent ticket's updatedAt on any change to its
    // attachments, atomically with the removal itself.
    prisma.ticket.update({ where: { id: attachment.ticketId }, data: { updatedAt: new Date() } }),
  ]);

  return updated;
}
