import { Router, type Request, type Response } from 'express';
import { requesterContext } from '../middleware/requesterContext.ts';
import { AttachmentNotFoundError, getOwnedAttachment } from '../services/attachmentAccess.ts';

// GET /api/attachments/:id — api-spec.md §4.2 (BR-14; AC-36).
//
// Mounted at /api/attachments (app.ts), separate from ticketsRouter — these
// are attachment-scoped, not ticket-scoped, even though ownership is always
// resolved through the attachment's parent ticket (§4 preamble, BR-14).
//
// GET /api/attachments/:id/download and DELETE /api/attachments/:id are
// added on top of this router by the next two slice-9b commits.
export const attachmentsRouter: Router = Router();

/** Largest value Postgres `int4` (and therefore Prisma `Int`) can hold. */
const PG_INT4_MAX = 2_147_483_647;

/**
 * Shape-validates the `:id` path param (api-spec.md §1.4: a non-integer
 * path parameter is treated as a resource that does not exist -> 404
 * NOT_FOUND, never 400 — "the route matched, the resource did not"). Same
 * rule and same bound-checking as `parseTicketIdParam` in routes/tickets.ts.
 */
function parseAttachmentIdParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > PG_INT4_MAX) {
    return null;
  }
  return id;
}

function attachmentNotFound(res: Response): void {
  // Byte-identical whether the attachment id is unknown or its ticket is
  // simply not owned by the caller (BR-14, BR-42, api-spec.md §1.4) — the
  // only place this route sends a 404.
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'Attachment not found.',
  });
}

function internalError(res: Response): void {
  res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
}

/**
 * The metadata shape §4.2's `GET /api/attachments/:id` response uses — the
 * same 9 keys the `POST` `201` body uses (routes/tickets.ts), deliberately
 * never including `storedFilename` (never exposed, BR-30) or `removedById`
 * (not part of any documented response shape).
 */
function attachmentToJson(attachment: {
  id: number;
  ticketId: number;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  isRemoved: boolean;
  removedAt: Date | null;
  removedReason: string | null;
  createdAt: Date;
}) {
  return {
    id: attachment.id,
    ticketId: attachment.ticketId,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    isRemoved: attachment.isRemoved,
    removedAt: attachment.removedAt,
    removedReason: attachment.removedReason,
    createdAt: attachment.createdAt,
  };
}

// ---------------------------------------------------------------------------
// GET /api/attachments/:id (api-spec.md §4.2)
// ---------------------------------------------------------------------------

attachmentsRouter.get('/:id', requesterContext, async (req: Request, res: Response) => {
  const attachmentId = parseAttachmentIdParam(String(req.params.id));
  if (attachmentId === null) {
    attachmentNotFound(res);
    return;
  }

  try {
    // Both active and removed attachments are returned here (§4.2, BR-33) —
    // getOwnedAttachment doesn't filter on isRemoved, only on ownership.
    const attachment = await getOwnedAttachment(attachmentId, req.requester!.id);
    res.status(200).json(attachmentToJson(attachment));
  } catch (error) {
    if (error instanceof AttachmentNotFoundError) {
      attachmentNotFound(res);
      return;
    }
    console.error('Error fetching attachment:', error);
    internalError(res);
  }
});
