import multer, { MulterError } from 'multer';
import { Router, type Request, type Response } from 'express';
import { requesterContext } from '../middleware/requesterContext.ts';
import { validateTicketFields, type FieldError } from '../validation/ticketFields.ts';
import { parseTicketListQuery } from '../validation/ticketListQuery.ts';
import { createTicket, ReferenceNotFoundError } from '../services/createTicket.ts';
import { validateAttachmentType, safeOriginalFilename, sniffMimeType } from '../validation/attachmentFile.ts';
import {
  AttachmentLimitError,
  MAX_ATTACHMENT_SIZE_BYTES,
  TicketNotFoundError,
  uploadAttachment,
} from '../services/uploadAttachment.ts';
import { prisma } from '../lib/prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';

// POST /api/tickets — api-spec.md §3.1 (BR-01, BR-02, BR-04, BR-12, BR-24,
// BR-25, BR-26, BR-28, BR-36; AC-01, AC-11..AC-14, AC-16, AC-43).
//
// GET /api/tickets — api-spec.md §3.2 (BR-15..BR-20, FR-24..FR-31; AC-03,
// AC-09, AC-22..AC-31).
//
// POST /api/tickets/:id/attachments — api-spec.md §4.1 (BR-14, BR-21..23,
// BR-27, BR-29, BR-30; AC-18..21).
export const ticketsRouter: Router = Router();

/** Largest value Postgres `int4` (and therefore Prisma `Int`) can hold. */
const PG_INT4_MAX = 2_147_483_647;

/**
 * Shape-validates `categoryId`/`relatedSystemId`: present and an integer.
 *
 * Ambiguity resolution (api-spec.md §3.1's table conflates two failure
 * modes under one "Must be an active X id" rule):
 *
 * - Missing, or not an integer at all — this is a *field-shape* failure,
 *   not a lookup failure. `404` for a field that was never a well-formed id
 *   would be a strange reading of "not found", and §1.3 reserves `fields[]`
 *   specifically for shape problems like this one. So this case is folded
 *   into `400 VALIDATION_FAILED` alongside summary/description/priority,
 *   exactly like a missing/malformed value for any other required field.
 * - A syntactically valid integer that doesn't exist, is inactive, or is
 *   simply outside Postgres `int4` range (and therefore cannot reference
 *   any row) — that's a *lookup* failure, which is what BR-36 and AC-43
 *   actually describe, so it is `404 NOT_FOUND` (checked separately, after
 *   this shape check passes, in `resolveReferences`). This mirrors the
 *   existing `requesterContext` middleware's treatment of an out-of-range
 *   `X-Requester-Id`.
 */
function validateReferenceIdShape(raw: unknown, field: 'categoryId' | 'relatedSystemId'): FieldError | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return { field, message: `${field} is required and must be an integer.` };
  }
  return null;
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

function notFound(res: Response): void {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'categoryId or relatedSystemId does not reference an active row.',
  });
}

function internalError(res: Response): void {
  res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
}

ticketsRouter.post('/', requesterContext, async (req: Request, res: Response) => {
  // express.json() (app.ts) parses in "strict" mode, which already rejects
  // a bare top-level primitive (e.g. `42`) as a parse error — caught by the
  // handler mounted right after it (app.ts) — before this guard ever runs.
  // What's left for this route to reject is a body that parsed fine but
  // isn't a plain object: a top-level JSON array (strict mode lets arrays
  // through) or a missing/undefined body (no/unhandled Content-Type), which
  // would otherwise fall through into the create path and crash (§1.4).
  if (!isPlainRequestBody(req.body)) {
    malformedBody(res);
    return;
  }

  const body = req.body;

  // The owner is always the header-resolved Requester (A-01) — a
  // `requesterId` in the body, if present, is read nowhere below and is
  // therefore silently ignored, per api-spec.md §3.1.
  const requesterId = req.requester!.id;

  const categoryIdError = validateReferenceIdShape(body.categoryId, 'categoryId');
  const relatedSystemIdError = validateReferenceIdShape(body.relatedSystemId, 'relatedSystemId');
  const fieldsResult = validateTicketFields(body);

  const fieldErrors: FieldError[] = [
    ...(categoryIdError ? [categoryIdError] : []),
    ...(relatedSystemIdError ? [relatedSystemIdError] : []),
    ...(fieldsResult.ok ? [] : fieldsResult.errors),
  ];

  if (fieldErrors.length > 0) {
    validationFailed(res, fieldErrors);
    return;
  }

  // Shape checks above guarantee these are integers by this point.
  const categoryId = body.categoryId as number;
  const relatedSystemId = body.relatedSystemId as number;
  // fieldsResult.ok is guaranteed true here too (fieldErrors was empty).
  const { summary, description, requestedPriority } = (
    fieldsResult as Extract<typeof fieldsResult, { ok: true }>
  ).value;

  // Out-of-int4-range ids cannot reference any row; querying with them would
  // raise a driver-level range error instead of a clean "not found" (same
  // reasoning as requesterContext's X-Requester-Id bounds check). Treat them
  // as a lookup failure here rather than letting that surface as a 500.
  if (Math.abs(categoryId) > PG_INT4_MAX || Math.abs(relatedSystemId) > PG_INT4_MAX) {
    notFound(res);
    return;
  }

  try {
    const ticket = await createTicket({
      requesterId,
      categoryId,
      relatedSystemId,
      requestedPriority,
      summary,
      description,
    });

    res.status(201).json({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requester: ticket.requester,
      category: ticket.category,
      relatedSystem: ticket.relatedSystem,
      requestedPriority: ticket.requestedPriority,
      status: ticket.status,
      summary: ticket.summary,
      description: ticket.description,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      attachments: [],
    });
  } catch (error) {
    if (error instanceof ReferenceNotFoundError) {
      notFound(res);
      return;
    }
    console.error('Error creating ticket:', error);
    internalError(res);
  }
});

function invalidQuery(res: Response, fields: FieldError[]): void {
  res.status(400).json({
    error: 'INVALID_QUERY',
    message: 'One or more query parameters are invalid.',
    fields,
  });
}

ticketsRouter.get('/', requesterContext, async (req: Request, res: Response) => {
  // req.query values are always string | string[] | ParsedQs | ParsedQs[] |
  // undefined; parseTicketListQuery treats anything other than a single
  // plain string as a shape failure for that param (no silent coercion —
  // BR-19, FR-29).
  const parsed = parseTicketListQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    invalidQuery(res, parsed.errors);
    return;
  }

  const { search, categoryId, priority, status, sort, order, page, pageSize } = parsed.value;

  try {
    // Ambiguity resolution (api-spec.md §3.2 vs §3.1): a categoryId that is
    // shape-valid (parseTicketListQuery already rejects anything that could
    // never be a real Category id) but names no active Category is a bad
    // *query* — a filter that can never match any ticket — not a missing
    // *resource*. That is deliberately different from POST /api/tickets,
    // where the same situation is 404 NOT_FOUND (the request is trying to
    // create something against a resource that isn't there). So this is
    // 400 INVALID_QUERY, not 404, per §3.2's rule table.
    if (categoryId !== undefined) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
        select: { isActive: true },
      });
      if (!category || !category.isActive) {
        invalidQuery(res, [
          { field: 'categoryId', message: 'categoryId does not reference a known active category.' },
        ]);
        return;
      }
    }

    const where: Prisma.TicketWhereInput = {
      // BR-15: always server-side scoped to the caller, unconditionally and
      // first — no filter below can widen the scope past this Requester,
      // regardless of what the query string asks for.
      requesterId: req.requester!.id,
      // BR-16: case-insensitive substring match on ticketNumber OR summary.
      // Blank/whitespace-only search was already normalized to `undefined`
      // by the parser, so its presence here always means a real search.
      ...(search !== undefined
        ? {
            OR: [
              { ticketNumber: { contains: search, mode: 'insensitive' as const } },
              { summary: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      // BR-17: categoryId/priority/status combine with the search clause
      // (and each other) with AND — they're just more top-level keys on the
      // same `where` object.
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(priority !== undefined ? { requestedPriority: priority } : {}),
      ...(status !== undefined ? { status } : {}),
    };

    // BR-18: secondary sort is always `id desc`, appended after whichever
    // field the caller chose, so rows that tie on the primary key (e.g.
    // several tickets created in the same millisecond) still come back in a
    // stable, deterministic order across requests and pages.
    const orderBy: Prisma.TicketOrderByWithRelationInput[] = [
      { [sort]: order } as Prisma.TicketOrderByWithRelationInput,
      { id: 'desc' },
    ];

    // BR-19: page past the last page is a normal 200 with items: [] — Prisma's
    // findMany simply returns no rows for a skip beyond the result set, so
    // no special-casing is needed here; it falls out of the query itself.
    const [totalItems, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true } },
          relatedSystem: { select: { id: true, name: true } },
          // Counts only non-removed attachments (a filtered relation
          // count) — #17 will start populating Attachment rows, but the
          // count must already be correct today: a ticket with none is 0.
          _count: { select: { attachments: { where: { isRemoved: false } } } },
        },
      }),
    ]);

    res.status(200).json({
      items: tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        summary: ticket.summary,
        category: ticket.category,
        relatedSystem: ticket.relatedSystem,
        requestedPriority: ticket.requestedPriority,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        activeAttachmentCount: ticket._count.attachments,
      })),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
        sort,
        order,
      },
    });
  } catch (error) {
    console.error('Error listing tickets:', error);
    internalError(res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/attachments (api-spec.md §4.1)
// ---------------------------------------------------------------------------

// Memory storage, not disk storage: BR-27 requires the file to be written
// under its final, server-generated `<uuidv4>.<ext>` name only after every
// other check (ownership, type, count) has passed, so multer must not pick
// the destination or the filename itself — this route calls
// `storeAttachmentFile` explicitly, once, after those checks. Buffering in
// memory is bounded by `limits.fileSize` below, so a client can't force an
// unbounded amount of memory use by streaming an enormous file.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES },
});

/** Runs `multer`'s single-file parse as a Promise so the route can `await` and `catch` it directly. */
function parseUploadedFile(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (error: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * Shape-validates the `:id` path param for an attachment-scoped route.
 *
 * api-spec.md §1.4: "A non-integer path parameter ... is treated as a
 * resource that does not exist -> 404 NOT_FOUND ... (no 400 — the route
 * matched, the resource did not)." So unlike `categoryId`/`relatedSystemId`
 * in the request body (§3.1, folded into 400 VALIDATION_FAILED), a
 * malformed `:id` here returns `null` and the caller maps that straight to
 * 404, never 400.
 */
function parseTicketIdParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > PG_INT4_MAX) {
    return null;
  }
  return id;
}

function noFile(res: Response): void {
  res.status(400).json({
    error: 'NO_FILE',
    message: 'A single non-empty "file" part is required (multipart/form-data).',
  });
}

function fileTooLarge(res: Response): void {
  res.status(413).json({
    error: 'FILE_TOO_LARGE',
    message: 'Attachment exceeds the 5 MB size limit.',
  });
}

function unsupportedType(res: Response): void {
  res.status(415).json({
    error: 'UNSUPPORTED_TYPE',
    message: 'File type must be JPEG, PNG, WEBP, or PDF, and its extension must match its content.',
  });
}

function attachmentLimit(res: Response): void {
  res.status(409).json({
    error: 'ATTACHMENT_LIMIT',
    message: 'This ticket already has the maximum number of active attachments.',
  });
}

function ticketNotFound(res: Response): void {
  // Byte-identical whether the ticket is unknown or simply not owned by the
  // caller (BR-14, api-spec.md §1.4) — this single function is the only
  // place this route ever sends a 404, so there is no way for the two cases
  // to drift apart.
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'Ticket not found.',
  });
}

ticketsRouter.post('/:id/attachments', requesterContext, async (req: Request, res: Response) => {
  const ticketId = parseTicketIdParam(String(req.params.id));
  if (ticketId === null) {
    ticketNotFound(res);
    return;
  }

  // Ownership is checked before the multipart body is ever parsed: BR-14
  // says existence of a not-owned resource must never be disclosed, and
  // that shouldn't depend on whether the request body happens to be
  // well-formed multipart data. This also avoids buffering a stranger's
  // upload into memory before finding out it was never going anywhere.
  let ownerId: number | null;
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { requesterId: true } });
    ownerId = ticket?.requesterId ?? null;
  } catch (error) {
    console.error('Error looking up ticket for attachment upload:', error);
    internalError(res);
    return;
  }
  if (ownerId === null || ownerId !== req.requester!.id) {
    ticketNotFound(res);
    return;
  }

  try {
    await parseUploadedFile(req, res);
  } catch (error) {
    if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
      fileTooLarge(res);
      return;
    }
    // Any other multer/busboy failure — no boundary because Content-Type
    // wasn't multipart/form-data at all, a malformed multipart body, more
    // than one file under the "file" field, etc. — is reported as the
    // simple "no usable file part" case §1.4a asks for, rather than a 500.
    noFile(res);
    return;
  }

  const file = req.file;
  if (!file || file.buffer.length === 0) {
    noFile(res);
    return;
  }

  const sniffedMimeType = sniffMimeType(file.buffer);
  const typeResult = validateAttachmentType(file.originalname, sniffedMimeType ?? '');
  if (!typeResult.ok) {
    unsupportedType(res);
    return;
  }

  const originalFilename = safeOriginalFilename(file.originalname);

  try {
    const attachment = await uploadAttachment({
      ticketId,
      requesterId: req.requester!.id,
      buffer: file.buffer,
      mimeType: typeResult.value.mimeType,
      extension: typeResult.value.extension,
      originalFilename,
    });

    res.status(201).json({
      id: attachment.id,
      ticketId: attachment.ticketId,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      isRemoved: attachment.isRemoved,
      removedAt: attachment.removedAt,
      removedReason: attachment.removedReason,
      createdAt: attachment.createdAt,
    });
  } catch (error) {
    if (error instanceof TicketNotFoundError) {
      // Can only happen if the ticket was deleted/reassigned in the window
      // between the ownership check above and this call — treat it the
      // same as never having found it.
      ticketNotFound(res);
      return;
    }
    if (error instanceof AttachmentLimitError) {
      attachmentLimit(res);
      return;
    }
    console.error('Error uploading attachment:', error);
    internalError(res);
  }
});
