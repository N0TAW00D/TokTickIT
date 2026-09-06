import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { requesterContext } from '../middleware/requesterContext.ts';
import { getUploadsDir } from '../services/attachmentStorage.ts';
import { AttachmentNotFoundError, getOwnedAttachment } from '../services/attachmentAccess.ts';
import { AttachmentAlreadyRemovedError, removeAttachment } from '../services/removeAttachment.ts';
import { validateRemovalReason } from '../validation/attachmentRemoval.ts';
import type { FieldError } from '../validation/ticketFields.ts';

// GET /api/attachments/:id — api-spec.md §4.2 (BR-14; AC-36).
// GET /api/attachments/:id/download — api-spec.md §4.3 (BR-30, BR-33;
// AC-33, AC-34, AC-37).
// DELETE /api/attachments/:id — api-spec.md §4.4 (BR-07, BR-31, BR-32, A-08,
// A-09; AC-34, AC-35, AC-36).
//
// Mounted at /api/attachments (app.ts), separate from ticketsRouter — these
// are attachment-scoped, not ticket-scoped, even though ownership is always
// resolved through the attachment's parent ticket (§4 preamble, BR-14).
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

function isPlainRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

function malformedBody(res: Response): void {
  res.status(400).json({
    error: 'MALFORMED_BODY',
    message: 'Request body must be a JSON object.',
  });
}

function validationFailed(res: Response, fields: FieldError[]): void {
  res.status(400).json({
    error: 'VALIDATION_FAILED',
    message: 'One or more fields are invalid.',
    fields,
  });
}

function attachmentNotFound(res: Response): void {
  // Byte-identical whether the attachment id is unknown or its ticket is
  // simply not owned by the caller (BR-14, BR-42, api-spec.md §1.4) — the
  // only place any of these three routes sends a 404.
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'Attachment not found.',
  });
}

function attachmentRemoved(res: Response): void {
  res.status(410).json({
    error: 'ATTACHMENT_REMOVED',
    message: 'This attachment has been removed.',
  });
}

function alreadyRemoved(res: Response): void {
  res.status(409).json({
    error: 'ALREADY_REMOVED',
    message: 'This attachment is already removed.',
  });
}

function internalError(res: Response): void {
  res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
}

/**
 * The metadata shape shared by §4.2's `GET /api/attachments/:id` response
 * and §4.4's `DELETE` response — the same 9 keys the `POST` `201` body uses
 * (routes/tickets.ts), deliberately never including `storedFilename` (never
 * exposed, BR-30) or `removedById` (not part of any documented response
 * shape).
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

// ---------------------------------------------------------------------------
// GET /api/attachments/:id/download (api-spec.md §4.3)
// ---------------------------------------------------------------------------

attachmentsRouter.get('/:id/download', requesterContext, async (req: Request, res: Response) => {
  const attachmentId = parseAttachmentIdParam(String(req.params.id));
  if (attachmentId === null) {
    attachmentNotFound(res);
    return;
  }

  try {
    const attachment = await getOwnedAttachment(attachmentId, req.requester!.id);

    // BR-33: a soft-removed attachment's download endpoint returns 410, not
    // the file — checked only after ownership is confirmed, so a stranger
    // probing a removed attachment id still sees 404, never 410 (410 would
    // disclose that the attachment exists).
    if (attachment.isRemoved) {
      attachmentRemoved(res);
      return;
    }

    // storedFilename is server-generated (attachmentStorage.ts) and never
    // derived from client input — reusing getUploadsDir's path resolution
    // here, not rebuilding it, keeps that guarantee intact.
    const absolutePath = path.join(getUploadsDir(), attachment.storedFilename);

    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch (fsError) {
      // §4.3: the metadata row proves the resource exists and is owned, so
      // a missing file on disk is deliberately a server fault (500), never
      // a 404.
      console.error(`Attachment file missing on disk for attachment ${attachmentId}:`, fsError);
      internalError(res);
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalFilename}"`);
    res.setHeader('Content-Length', String(attachment.fileSize));
    res.send(buffer);
  } catch (error) {
    if (error instanceof AttachmentNotFoundError) {
      attachmentNotFound(res);
      return;
    }
    console.error('Error downloading attachment:', error);
    internalError(res);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/attachments/:id (api-spec.md §4.4)
// ---------------------------------------------------------------------------

attachmentsRouter.delete('/:id', requesterContext, async (req: Request, res: Response) => {
  // Path-shape check first, same precedence as the other two routes and as
  // routes/tickets.ts's POST /:id/attachments: a non-integer id is 404
  // regardless of the request body (§1.4 — "the route matched, the resource
  // did not" outranks a body-shape problem).
  const attachmentId = parseAttachmentIdParam(String(req.params.id));
  if (attachmentId === null) {
    attachmentNotFound(res);
    return;
  }

  // §1.4a: DELETE /api/attachments/:id requires Content-Type:
  // application/json; anything else (or a non-object body) -> 400
  // MALFORMED_BODY. Same guard as POST /api/tickets (routes/tickets.ts).
  if (!isPlainRequestBody(req.body)) {
    malformedBody(res);
    return;
  }

  // Field validation before the ownership/already-removed lookup, matching
  // POST /api/tickets's order (shape/validation errors precede existence
  // checks) — and it also means a reason that fails validation never
  // discloses anything about whether the id is owned, unknown, or removed.
  const reasonResult = validateRemovalReason(req.body.reason);
  if (!reasonResult.ok) {
    validationFailed(res, [reasonResult.error]);
    return;
  }

  try {
    const updated = await removeAttachment({
      attachmentId,
      requesterId: req.requester!.id,
      reason: reasonResult.value,
    });
    res.status(200).json(attachmentToJson(updated));
  } catch (error) {
    if (error instanceof AttachmentNotFoundError) {
      attachmentNotFound(res);
      return;
    }
    if (error instanceof AttachmentAlreadyRemovedError) {
      alreadyRemoved(res);
      return;
    }
    console.error('Error removing attachment:', error);
    internalError(res);
  }
});
