// Shared ownership lookup for the slice-9b endpoints — GET /api/attachments/:id,
// GET /api/attachments/:id/download, and DELETE /api/attachments/:id
// (api-spec.md §4 preamble: "Ownership is checked through the attachment's
// parent ticket"; specification.md BR-14, BR-42).
//
// Reuses the same ownership idiom uploadAttachment.ts established for
// POST /api/tickets/:id/attachments (a not-found ticket and a
// not-owned ticket throw the identical error), just addressed from the
// attachment side rather than the ticket side, so all three read/write
// endpoints below share one place that can answer "does this attachment
// exist, and is its ticket owned by this caller".

import { prisma } from '../lib/prisma.ts';
import type { AuthenticatedUser } from '../middleware/authContext.ts';

/**
 * Thrown when the attachment id doesn't exist, or exists but its parent
 * ticket isn't owned by the caller. Every route maps this to the same
 * `404 NOT_FOUND` body (BR-14, BR-42) — the two cases are indistinguishable
 * by design, so there is exactly one place in each route that produces this
 * response.
 */
export class AttachmentNotFoundError extends Error {
  constructor() {
    super('Attachment not found or not owned by the caller');
    this.name = 'AttachmentNotFoundError';
  }
}

/**
 * Looks up one attachment by id and verifies its parent ticket is owned by
 * `requesterId`, in a single round trip (the same shape as
 * uploadAttachment.ts's ticket lookup). Returns the full row — including
 * `storedFilename` and `removedById`, which callers need internally but must
 * never echo back in a response body — or throws `AttachmentNotFoundError`.
 *
 * Both active and removed attachments resolve here (BR-33: §4.2 lists both);
 * callers that must reject a removed attachment (the download route, §4.3)
 * check `isRemoved` themselves after this returns.
 */
export async function getOwnedAttachment(attachmentId: number, requesterId: number) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { ticket: { select: { requesterId: true } } },
  });

  if (!attachment || attachment.ticket.requesterId !== requesterId) {
    throw new AttachmentNotFoundError();
  }

  return attachment;
}

/**
 * The download-route counterpart to `getOwnedAttachment`, for
 * GET /api/attachments/:id/download only (api-spec.md §4.3, §5 preamble):
 * a REQUESTER caller is still ownership-checked exactly as above, but
 * IT_STAFF/ADMINISTRATOR have no ownership restriction at all — the same
 * "fold the role check into the query, not fetch-then-compare" idiom
 * routes/tickets.ts's `GET /:id` uses for `isStaff` (BR-14 still applies to
 * a Requester; §5's read-any-ticket grant for staff extends to the
 * attachments on it, so a not-owning Requester and a staff caller reading
 * the very same row take different branches here, not two different
 * functions).
 *
 * GET /api/attachments/:id (metadata) and DELETE /api/attachments/:id stay
 * on `getOwnedAttachment` — this function exists only because the download
 * route's auth was widened, not because ownership semantics changed for
 * the other two.
 */
export async function getDownloadableAttachment(attachmentId: number, caller: Pick<AuthenticatedUser, 'id' | 'role'>) {
  const isStaff = caller.role === 'IT_STAFF' || caller.role === 'ADMINISTRATOR';

  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { ticket: { select: { requesterId: true } } },
  });

  if (!attachment || (!isStaff && attachment.ticket.requesterId !== caller.id)) {
    throw new AttachmentNotFoundError();
  }

  return attachment;
}
