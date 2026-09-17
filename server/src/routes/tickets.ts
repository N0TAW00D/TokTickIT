import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, passwordChangeGate, requireRole, type AuthenticatedUser } from '../middleware/authContext.ts';
import { validateTicketFields, PRIORITIES, type FieldError, type Priority } from '../validation/ticketFields.ts';
import { validateCommentBody } from '../validation/commentFields.ts';
import { parseTicketListQuery } from '../validation/ticketListQuery.ts';
import { createTicket, ReferenceNotFoundError, TICKET_INCLUDE } from '../services/createTicket.ts';
import { validateAttachmentType, safeOriginalFilename, sniffMimeType } from '../validation/attachmentFile.ts';
import {
  AttachmentLimitError,
  MAX_ATTACHMENT_SIZE_BYTES,
  TicketNotFoundError,
  uploadAttachment,
} from '../services/uploadAttachment.ts';
import { prisma } from '../lib/prisma.ts';
import type { Prisma } from '../generated/prisma/client.ts';
// Imported as a value (not `import type`) here — unlike
// staffTicketQueueQuery.ts's hand-rolled `STAFF_QUEUE_STATUSES`, PATCH
// /:id/status (below) validates the incoming `status` field against the
// generated Prisma enum directly, so the eight permitted strings and the
// transition matrix's keys can never drift out of sync with schema.prisma.
import { TicketStatus } from '../generated/prisma/client.ts';

// POST /api/tickets — api-spec.md §3.1 (BR-01, BR-02, BR-04, BR-12, BR-24,
// BR-25, BR-26, BR-28, BR-36; AC-01, AC-11..AC-14, AC-16, AC-43).
//
// GET /api/tickets — api-spec.md §3.2 (BR-15..BR-20, FR-24..FR-31; AC-03,
// AC-09, AC-22..AC-31).
//
// GET /api/tickets/:id — api-spec.md §3.3 (BR-14, BR-33, BR-38, BR-39,
// BR-42; FR-32..FR-34; AC-32, AC-37, AC-38), reused unchanged for Requesters
// and extended per api-spec.md §5 (FR-20, AC-67) so IT Staff/Administrators
// can fetch any ticket and additionally see `itPriority`.
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
 *   int4-range treatment of `categoryId`/`relatedSystemId` a few lines
 *   below in this same file.
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

ticketsRouter.post('/', requireJsonContentType, authenticate, passwordChangeGate, requireRole('REQUESTER'), async (req: Request, res: Response) => {
  // express.json() (app.ts) parses in "strict" mode, which already rejects
  // a bare top-level primitive (e.g. `42`) as a parse error — caught by the
  // handler mounted right after it (app.ts) — before this guard ever runs.
  // requireJsonContentType above already turns a missing/non-JSON
  // Content-Type into 415 before this handler runs at all (BR-40), so
  // what's left for this guard to reject is a body that declared
  // `application/json` and parsed fine but isn't a plain object — a
  // top-level JSON array (strict mode lets arrays through) — which would
  // otherwise fall through into the create path and crash (§1.4).
  if (!isPlainRequestBody(req.body)) {
    malformedBody(res);
    return;
  }

  const body = req.body;

  // The owner is always the authenticated Requester (BR-03, BR-14) — a
  // `requesterId` in the body, if present, is read nowhere below and is
  // therefore silently ignored, per api-spec.md §3 (Lab 3 change:
  // identity comes from the session, not X-Requester-Id).
  const requesterId = req.authUser!.id;

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
  // raise a driver-level range error instead of a clean "not found". Treat
  // them as a lookup failure here rather than letting that surface as a 500.
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

ticketsRouter.get('/', authenticate, passwordChangeGate, requireRole('REQUESTER'), async (req: Request, res: Response) => {
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
      requesterId: req.authUser!.id,
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
// GET /api/tickets/:id (api-spec.md §3.3)
// ---------------------------------------------------------------------------

// Explicit field list, not `select: { ... every scalar ... }` or a bare
// `include: { attachments: true }` — the Attachment model (schema.prisma)
// also carries `storedFilename` (the server-generated `<uuidv4>.<ext>` disk
// name) and `removedById`, neither of which api-spec.md §3.3's example
// response includes. `storedFilename` in particular is an internal detail
// BR-41 forbids leaking, so it must never even reach this `select` — not be
// filtered out after the fact.
const TICKET_DETAIL_ATTACHMENT_SELECT = {
  id: true,
  originalFilename: true,
  mimeType: true,
  fileSize: true,
  isRemoved: true,
  removedAt: true,
  removedReason: true,
  createdAt: true,
} as const;

// The `include` shared by both the Requester and staff lookups below —
// identical fields either way; only the `where` clause (own-ticket-only vs.
// any-ticket) and the response's `itPriority` key differ by role.
const TICKET_DETAIL_INCLUDE = {
  ...TICKET_INCLUDE,
  // ui-spec.md §7: Ticket Owner shows as a read-only row ("Unassigned" or
  // the owner's name) for every role that can reach this route.
  owner: { select: { id: true, name: true } },
  attachments: {
    // BR-33: both active and soft-removed attachments are listed here
    // (unlike GET /api/tickets's activeAttachmentCount, which counts only
    // non-removed rows) — no `where` filter on `isRemoved` at all. Ordered
    // by id asc (creation order, with the same tie-break convention as
    // BR-18) purely for a stable, deterministic response; the spec does not
    // mandate a particular order.
    orderBy: { id: 'asc' },
    select: TICKET_DETAIL_ATTACHMENT_SELECT,
  },
} satisfies Prisma.TicketInclude;

ticketsRouter.get(
  '/:id',
  authenticate,
  passwordChangeGate,
  // api-spec.md §5: reused for Ticket Detail — IT Staff and Administrators
  // may fetch any ticket, a Requester only their own (FR-20, AC-67).
  requireRole('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    // §1.4: a non-integer (or otherwise malformed/out-of-range) `:id` is
    // treated as a resource that does not exist, never a 400 — same helper
    // the attachments route below already uses for its own `:id`.
    const ticketId = parseTicketIdParam(String(req.params.id));
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    const isStaff = req.authUser!.role === 'IT_STAFF' || req.authUser!.role === 'ADMINISTRATOR';

    try {
      // Same "fold the access check into the query, not fetch-then-compare"
      // shape `resolveTicketAccess` (below, used by the comments routes)
      // applies — it isn't called directly here because those routes only
      // need a thin `TicketAccessRow`, while this one needs the full detail
      // payload (with `include`) in the same round trip. A Requester's
      // `where` still folds ownership straight in (BR-15's pattern): an
      // unknown id and one owned by another Requester both simply fail to
      // match and fall into the one `if (!ticket)` branch below, which
      // calls the one shared `ticketNotFound` helper — there is
      // deliberately no second branch that decides "not owned" separately
      // from "not found", so BR-14/BR-42's byte-identical requirement can't
      // drift apart. IT Staff/Administrators have no ownership restriction
      // at all: any existing id resolves, unknown ids still 404.
      const ticket = await prisma.ticket.findFirst({
        where: isStaff ? { id: ticketId } : { id: ticketId, requesterId: req.authUser!.id },
        include: TICKET_DETAIL_INCLUDE,
      });

      if (!ticket) {
        ticketNotFound(res);
        return;
      }

      res.status(200).json({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        requester: ticket.requester,
        category: ticket.category,
        relatedSystem: ticket.relatedSystem,
        requestedPriority: ticket.requestedPriority,
        // api-spec.md §5/§9: IT Staff and Administrators additionally get
        // `itPriority`; a Requester never sees it (ui-spec.md §7) — the key
        // is omitted entirely for them, never sent as `null`.
        ...(isStaff ? { itPriority: ticket.itPriority } : {}),
        status: ticket.status,
        summary: ticket.summary,
        description: ticket.description,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        attachments: ticket.attachments,
        // api-spec.md §9 (Lab 3 change): null when unassigned — the client
        // renders that as "Unassigned" (ui-spec.md §7).
        owner: ticket.owner,
        // BR-26: null until the Requester has indicated the problem appears
        // resolved; never cleared by this route.
        requesterResolvedAt: ticket.requesterResolvedAt,
      });
    } catch (error) {
      console.error('Error fetching ticket:', error);
      internalError(res);
    }
  },
);

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
//
// `defParamCharset: 'utf8'` overrides multer's own default of `'latin1'`
// for this option, which it otherwise passes straight through to busboy.
// Without it, busboy decodes the `filename`/`filename*` Content-Disposition
// parameter of the file part as latin1: each raw UTF-8 byte of a non-ASCII
// name (e.g. `résumé.pdf`) becomes its own latin1 code point, and
// `file.originalname` arrives already mojibake'd — re-encoding those code
// points back to UTF-8 is what produced the doubled bytes (`Ã©` for `é`)
// this fix corrects. Setting it to 'utf8' makes busboy instead reinterpret
// those raw bytes as UTF-8, so `file.originalname` is correct before
// `safeOriginalFilename` (BR-29) ever sees it. ASCII filenames are encoded
// identically in latin1 and UTF-8, so this is a no-op for the common case.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES },
  defParamCharset: 'utf8',
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

ticketsRouter.post('/:id/attachments', authenticate, passwordChangeGate, requireRole('REQUESTER'), async (req: Request, res: Response) => {
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
  if (ownerId === null || ownerId !== req.authUser!.id) {
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
      requesterId: req.authUser!.id,
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

// ---------------------------------------------------------------------------
// Public Comments and "Problem Appears Resolved"
// (api-spec.md §3.1-3.3; specification.md FR-16..FR-18, BR-04, BR-05,
// BR-15..BR-18, BR-26; AC-21..AC-25, AC-65)
//
// Internal Notes (`GET`/`POST /api/tickets/:id/notes`) are explicitly out of
// scope for this issue (#72's job) — nothing below touches them.
// ---------------------------------------------------------------------------

function forbidden(res: Response): void {
  res.status(403).json({
    error: 'FORBIDDEN',
    message: 'You do not have permission to perform this action.',
  });
}

function unsupportedMediaType(res: Response): void {
  res.status(415).json({
    error: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Content-Type must be application/json.',
  });
}

/**
 * BR-40 (api-spec.md §1.6): every state-changing endpoint requires
 * `Content-Type: application/json`, else `415`. Mounted first, ahead of
 * `authenticate`, matching the order `src/routes/auth.ts`'s own
 * `requireJsonContentType` uses on every one of its POST routes (including
 * `POST /api/auth/logout`, which — like `POST /api/tickets/:id/
 * requester-resolved` below — documents no request body at all: BR-40's
 * CSRF argument (D-04) needs the Content-Type gate on every state-changing
 * request regardless of whether that request carries a body, since a
 * cross-site form can't set this header either way).
 */
function requireJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    unsupportedMediaType(res);
    return;
  }
  next();
}

const COMMENT_AUTHOR_SELECT = {
  id: true,
  name: true,
  role: true,
} as const;

interface PublicCommentRow {
  id: number;
  body: string;
  createdAt: Date;
  author: { id: number; name: string; role: string };
}

function commentToJson(comment: PublicCommentRow) {
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    author: comment.author,
  };
}

interface TicketAccessRow {
  id: number;
  requesterId: number;
  status: TicketStatus;
  // Only PATCH /:id/status (below) reads this — OWNER_REQUIRED needs the
  // ticket's current owner alongside its current status, and both are
  // needed in the same round trip that already confirms the ticket exists
  // and classifies the caller's access, so it's folded into this shared
  // select rather than a second query.
  ownerId: number | null;
}

type TicketAccess =
  | { kind: 'not-found' }
  | { kind: 'owner'; ticket: TicketAccessRow }
  | { kind: 'staff'; ticket: TicketAccessRow };

/**
 * Resolves the ticket for a Public-Comment/resolution-indication route and
 * classifies the caller's read path, implementing the three-case 403/404
 * precedence (api-spec.md §1.4, specification.md §8.2):
 *
 * - No such ticket -> `'not-found'` (nobody has a read path to a record
 *   that doesn't exist, regardless of role).
 * - Caller is the owning Requester -> `'owner'`.
 * - Caller is a REQUESTER who does not own it -> `'not-found'` (case 2:
 *   Requesters have no read path to another Requester's ticket at all,
 *   BR-13) — byte-identical to an unknown id.
 * - Caller is IT_STAFF or ADMINISTRATOR -> `'staff'` (case 3: both can
 *   already read any ticket via the staff/admin read paths — §4.1 — so a
 *   write they lack is a safe `403`, never a `404`).
 */
async function resolveTicketAccess(ticketId: number, authUser: AuthenticatedUser): Promise<TicketAccess> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, requesterId: true, status: true, ownerId: true },
  });

  if (!ticket) {
    return { kind: 'not-found' };
  }

  if (authUser.role === 'REQUESTER') {
    return ticket.requesterId === authUser.id ? { kind: 'owner', ticket } : { kind: 'not-found' };
  }

  return { kind: 'staff', ticket };
}

// ---------------------------------------------------------------------------
// GET /api/tickets/:id/comments (api-spec.md §3.1)
// ---------------------------------------------------------------------------

ticketsRouter.get(
  '/:id/comments',
  authenticate,
  passwordChangeGate,
  requireRole('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    const ticketId = parseTicketIdParam(String(req.params.id));
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    try {
      // BR-04: the owning Requester, any IT Staff, and any Administrator
      // may all read the thread — every branch except 'not-found' reads.
      const access = await resolveTicketAccess(ticketId, req.authUser!);
      if (access.kind === 'not-found') {
        ticketNotFound(res);
        return;
      }

      const comments = await prisma.publicComment.findMany({
        where: { ticketId },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: COMMENT_AUTHOR_SELECT } },
      });

      res.status(200).json(comments.map(commentToJson));
    } catch (error) {
      console.error('Error listing public comments:', error);
      internalError(res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/comments (api-spec.md §3.2)
// ---------------------------------------------------------------------------

ticketsRouter.post(
  '/:id/comments',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  requireRole('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    const ticketId = parseTicketIdParam(String(req.params.id));
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    if (!isPlainRequestBody(req.body)) {
      malformedBody(res);
      return;
    }

    try {
      const access = await resolveTicketAccess(ticketId, req.authUser!);
      if (access.kind === 'not-found') {
        ticketNotFound(res);
        return;
      }

      // Administrators can already read this ticket (case 3 — 'staff'
      // above) but api-spec.md §3.2 / specification.md §4.1 explicitly
      // deny them the write: "Administrators may read comments but not
      // post them." IT Staff, in the same 'staff' branch, MAY post — so
      // this is the one place the two staff-ish roles diverge.
      if (req.authUser!.role === 'ADMINISTRATOR') {
        forbidden(res);
        return;
      }

      const bodyResult = validateCommentBody(req.body.body);
      if (!bodyResult.ok) {
        validationFailed(res, [bodyResult.error]);
        return;
      }

      // BR-16: author and createdAt are always server-set — any
      // client-supplied `author`/`createdAt` in the body is read nowhere
      // above and is therefore silently ignored.
      const comment = await prisma.publicComment.create({
        data: {
          ticketId,
          authorId: req.authUser!.id,
          body: bodyResult.value,
        },
        include: { author: { select: COMMENT_AUTHOR_SELECT } },
      });

      res.status(201).json(commentToJson(comment));
    } catch (error) {
      console.error('Error creating public comment:', error);
      internalError(res);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/tickets/:id/owner (api-spec.md §5.1)
// ---------------------------------------------------------------------------

function invalidOwner(res: Response): void {
  // BR-20/AC-36: an inactive user, a Requester, and a nonexistent id all
  // return this identical body — never a hint as to which one it was.
  res.status(409).json({
    error: 'INVALID_OWNER',
    message: 'ownerId must reference an active IT Staff or Administrator user.',
  });
}

/**
 * Shape-validates the `ownerId` field for `PATCH /api/tickets/:id/owner`:
 * unlike `validateReferenceIdShape` above (required, always an int), this
 * field's contract (api-spec.md §5.1) is `number | null` — `null` is a
 * legal, meaningful value ("unassign"), not a missing-field failure. So a
 * present `null` passes shape validation; anything present but neither an
 * integer nor `null` (a string, a float, a boolean, an array/object, or the
 * key simply missing) is a 400 VALIDATION_FAILED, matching this file's
 * existing "malformed shape -> 400, valid shape that fails a lookup -> a
 * dedicated conflict/not-found code" split.
 */
function validateOwnerIdShape(raw: unknown): FieldError | null {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return { field: 'ownerId', message: 'ownerId is required and must be an integer or null.' };
  }
  return null;
}

ticketsRouter.patch(
  '/:id/owner',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  // requireRole lets every role through here (rather than gating to
  // IT_STAFF alone) so a Requester and an unknown ticket id both fall
  // through to the same resolveTicketAccess-driven 404 below, instead of
  // requireRole intercepting the Requester case with a 403 first — the same
  // "decide precisely inside the handler" pattern the comments/
  // requester-resolved routes above already use.
  requireRole('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    const ticketId = parseTicketIdParam(String(req.params.id));
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    if (!isPlainRequestBody(req.body)) {
      malformedBody(res);
      return;
    }

    const ownerIdError = validateOwnerIdShape(req.body.ownerId);
    if (ownerIdError) {
      validationFailed(res, [ownerIdError]);
      return;
    }
    // Shape check above guarantees this is `number | null`.
    const requestedOwnerId = req.body.ownerId as number | null;

    try {
      const access = await resolveTicketAccess(ticketId, req.authUser!);

      // api-spec.md §5.1: a Requester never gets a write path here,
      // regardless of ownership — unlike POST /api/tickets/:id/comments
      // above (where the owning Requester's own 'owner' branch is a valid
      // write path), this route has no Requester write path at all, so both
      // the 'not-found' and 'owner' classifications resolveTicketAccess can
      // produce for a REQUESTER caller collapse to the same 404 here.
      if (access.kind === 'not-found' || access.kind === 'owner') {
        ticketNotFound(res);
        return;
      }

      // access.kind === 'staff' here: IT Staff and Administrator both have
      // a read path to this ticket (GET /api/tickets/:id, api-spec.md §5),
      // but api-spec.md §5.1 reserves the write for IT Staff only — an
      // Administrator's read path makes this a safe 403, never a 404.
      if (req.authUser!.role === 'ADMINISTRATOR') {
        forbidden(res);
        return;
      }

      if (requestedOwnerId !== null) {
        const candidate = await prisma.user.findUnique({
          where: { id: requestedOwnerId },
          select: { role: true, isActive: true },
        });
        // BR-19/BR-20: the candidate must exist, be active, and not be a
        // Requester (a Ticket Owner may only be an active IT Staff or
        // Administrator user) — any failure of the three is the identical
        // 409 INVALID_OWNER, checked together so no branch can leak which
        // one it was.
        if (!candidate || !candidate.isActive || candidate.role === 'REQUESTER') {
          invalidOwner(res);
          return;
        }
      }

      const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: { ownerId: requestedOwnerId },
        include: TICKET_DETAIL_INCLUDE,
      });

      res.status(200).json({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        requester: ticket.requester,
        category: ticket.category,
        relatedSystem: ticket.relatedSystem,
        requestedPriority: ticket.requestedPriority,
        itPriority: ticket.itPriority,
        status: ticket.status,
        summary: ticket.summary,
        description: ticket.description,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        attachments: ticket.attachments,
        owner: ticket.owner,
        requesterResolvedAt: ticket.requesterResolvedAt,
      });
    } catch (error) {
      console.error('Error updating ticket owner:', error);
      internalError(res);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/tickets/:id/it-priority (api-spec.md §5.2)
// ---------------------------------------------------------------------------

/**
 * Shape-validates the `itPriority` field for `PATCH /api/tickets/:id/it-priority`:
 * unlike `validateOwnerIdShape` above, there is no meaningful "clear" value
 * here — the field is required and must be exactly one of the three
 * `Priority` enum strings (api-spec.md §5.2). This mirrors
 * `validateRequestedPriority` in ticketFields.ts, but that helper is tied to
 * the `requestedPriority` field name/message (ticket-creation, §4-fields) and
 * this route touches a different field (`itPriority`) with its own message,
 * so it isn't directly reusable — the `PRIORITIES` enum itself is reused
 * instead of redeclaring it.
 */
function validateItPriorityShape(raw: unknown): FieldError | null {
  if (typeof raw !== 'string' || !PRIORITIES.includes(raw as Priority)) {
    return { field: 'itPriority', message: 'itPriority must be one of LOW, MEDIUM, HIGH.' };
  }
  return null;
}

ticketsRouter.patch(
  '/:id/it-priority',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  // Same "decide precisely inside the handler" pattern as PATCH
  // /:id/owner above: requireRole lets every role through so a Requester
  // and an unknown ticket id both fall through to the same
  // resolveTicketAccess-driven 404 below, instead of requireRole
  // intercepting the Requester case with a 403 first.
  requireRole('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    const ticketId = parseTicketIdParam(String(req.params.id));
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    if (!isPlainRequestBody(req.body)) {
      malformedBody(res);
      return;
    }

    const itPriorityError = validateItPriorityShape(req.body.itPriority);
    if (itPriorityError) {
      validationFailed(res, [itPriorityError]);
      return;
    }
    // Shape check above guarantees this is one of the three Priority values.
    const requestedItPriority = req.body.itPriority as Priority;

    try {
      const access = await resolveTicketAccess(ticketId, req.authUser!);

      // api-spec.md §5.2: a Requester never gets a write path here,
      // regardless of ownership — same collapse as PATCH /:id/owner — both
      // the 'not-found' and 'owner' classifications resolveTicketAccess can
      // produce for a REQUESTER caller become the identical 404 here.
      if (access.kind === 'not-found' || access.kind === 'owner') {
        ticketNotFound(res);
        return;
      }

      // access.kind === 'staff' here: unlike PATCH /:id/owner (IT Staff
      // only), api-spec.md §5.2/BR-22 lets BOTH IT Staff and Administrator
      // perform this write — the one staff-write route where the two roles
      // do not diverge — so there is no further role check.
      const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: { itPriority: requestedItPriority },
        include: TICKET_DETAIL_INCLUDE,
      });

      res.status(200).json({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        requester: ticket.requester,
        category: ticket.category,
        relatedSystem: ticket.relatedSystem,
        requestedPriority: ticket.requestedPriority,
        itPriority: ticket.itPriority,
        status: ticket.status,
        summary: ticket.summary,
        description: ticket.description,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        attachments: ticket.attachments,
        owner: ticket.owner,
        requesterResolvedAt: ticket.requesterResolvedAt,
      });
    } catch (error) {
      console.error('Error updating ticket IT priority:', error);
      internalError(res);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/tickets/:id/status (api-spec.md §5.3)
// ---------------------------------------------------------------------------

/**
 * The status transition matrix (specification.md §5.1): an explicit map of
 * every status to the list of statuses it may move to directly. A pair not
 * present here — including a status mapped to itself, which no row lists —
 * is rejected as `409 INVALID_TRANSITION` (BR-23), so a same-state "no-op"
 * request is not silently accepted as a 200.
 *
 * Keyed off the generated Prisma `TicketStatus` enum (not a hand-rolled
 * list, unlike `staffTicketQueueQuery.ts`'s `STAFF_QUEUE_STATUSES`) so this
 * matrix can never fall out of sync with schema.prisma — `Record<TicketStatus,
 * TicketStatus[]>` also means TypeScript itself enforces that every enum
 * member has a row.
 */
const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.NEW]: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.CANCELLED],
  [TicketStatus.OPEN]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_FOR_REQUESTER,
    TicketStatus.RESOLVED,
    TicketStatus.CANCELLED,
  ],
  [TicketStatus.IN_PROGRESS]: [TicketStatus.WAITING_FOR_REQUESTER, TicketStatus.RESOLVED, TicketStatus.CANCELLED],
  [TicketStatus.WAITING_FOR_REQUESTER]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.CANCELLED],
  [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.REOPENED],
  [TicketStatus.CLOSED]: [TicketStatus.REOPENED],
  [TicketStatus.REOPENED]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_FOR_REQUESTER,
    TicketStatus.RESOLVED,
    TicketStatus.CANCELLED,
  ],
  // Terminal (specification.md §5.1): no row lists CANCELLED as a
  // destination back out of it, so this list is empty rather than absent —
  // absent would make `TICKET_STATUS_TRANSITIONS[access.ticket.status]`
  // `undefined` and require a separate branch below just for this one case.
  [TicketStatus.CANCELLED]: [],
};

const ALL_TICKET_STATUSES: readonly string[] = Object.values(TicketStatus);

/**
 * Shape-validates the `status` field for `PATCH /api/tickets/:id/status`:
 * required, and must be exactly one of the eight `TicketStatus` enum
 * strings. Whether that value is actually *reachable* from the ticket's
 * current status is a separate, later question — a syntactically valid but
 * unreachable status (e.g. `"CLOSED"` from `NEW`) is a `409
 * INVALID_TRANSITION` below, not a `400` here (api-spec.md §5.3).
 */
function validateStatusShape(raw: unknown): FieldError | null {
  if (typeof raw !== 'string' || !ALL_TICKET_STATUSES.includes(raw)) {
    return {
      field: 'status',
      message:
        'status must be one of NEW, OPEN, IN_PROGRESS, WAITING_FOR_REQUESTER, RESOLVED, CLOSED, REOPENED, CANCELLED.',
    };
  }
  return null;
}

function invalidTransition(res: Response): void {
  res.status(409).json({
    error: 'INVALID_TRANSITION',
    message: 'This status transition is not permitted from the ticket’s current status.',
  });
}

function ownerRequired(res: Response): void {
  res.status(409).json({
    error: 'OWNER_REQUIRED',
    message: 'This ticket must have an owner before it can move to In Progress.',
  });
}

ticketsRouter.patch(
  '/:id/status',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  // Same "decide precisely inside the handler" pattern as PATCH
  // /:id/owner and /:id/it-priority above: requireRole lets every role
  // through so a Requester and an unknown ticket id both fall through to
  // the same resolveTicketAccess-driven 404 below, instead of requireRole
  // intercepting the Requester case with a 403 first.
  requireRole('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    const ticketId = parseTicketIdParam(String(req.params.id));
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    if (!isPlainRequestBody(req.body)) {
      malformedBody(res);
      return;
    }

    const statusError = validateStatusShape(req.body.status);
    if (statusError) {
      validationFailed(res, [statusError]);
      return;
    }
    // Shape check above guarantees this is one of the eight enum values.
    const requestedStatus = req.body.status as TicketStatus;

    try {
      const access = await resolveTicketAccess(ticketId, req.authUser!);

      // api-spec.md §5.3: a Requester never gets a write path here,
      // regardless of ownership — same collapse as PATCH /:id/owner and
      // /:id/it-priority — both the 'not-found' and 'owner' classifications
      // resolveTicketAccess can produce for a REQUESTER caller become the
      // identical 404 here.
      if (access.kind === 'not-found' || access.kind === 'owner') {
        ticketNotFound(res);
        return;
      }

      // access.kind === 'staff' here: like PATCH /:id/owner (and unlike
      // /:id/it-priority), status is IT Staff only — an Administrator
      // already has a read path to this ticket (GET /api/tickets/:id), so
      // this is a safe 403, never a 404.
      if (req.authUser!.role === 'ADMINISTRATOR') {
        forbidden(res);
        return;
      }

      // BR-23/AC-39: checked against the ticket's CURRENT status, including
      // the same-state case (no row lists a status as its own successor, so
      // that pair is simply absent from the list below too).
      const permittedNextStatuses = TICKET_STATUS_TRANSITIONS[access.ticket.status];
      if (!permittedNextStatuses.includes(requestedStatus)) {
        invalidTransition(res);
        return;
      }

      // BR-24/AC-40: OWNER_REQUIRED only applies once the transition itself
      // is otherwise valid per the matrix above — checked second, and only
      // for the one destination status (IN_PROGRESS) it governs, regardless
      // of which row supplied the otherwise-valid transition.
      if (requestedStatus === TicketStatus.IN_PROGRESS && access.ticket.ownerId === null) {
        ownerRequired(res);
        return;
      }

      const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: { status: requestedStatus },
        include: TICKET_DETAIL_INCLUDE,
      });

      res.status(200).json({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        requester: ticket.requester,
        category: ticket.category,
        relatedSystem: ticket.relatedSystem,
        requestedPriority: ticket.requestedPriority,
        itPriority: ticket.itPriority,
        status: ticket.status,
        summary: ticket.summary,
        description: ticket.description,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        attachments: ticket.attachments,
        owner: ticket.owner,
        requesterResolvedAt: ticket.requesterResolvedAt,
      });
    } catch (error) {
      console.error('Error updating ticket status:', error);
      internalError(res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/requester-resolved (api-spec.md §3.3)
// ---------------------------------------------------------------------------

/** BR-05/BR-26: nothing left to report once the ticket has reached one of these. */
const RESOLUTION_TERMINAL_STATUSES: ReadonlySet<TicketStatus> = new Set(['RESOLVED', 'CLOSED', 'CANCELLED']);

function invalidState(res: Response): void {
  res.status(409).json({
    error: 'INVALID_STATE',
    message: 'This ticket is already Resolved, Closed or Cancelled.',
  });
}

ticketsRouter.post(
  '/:id/requester-resolved',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  requireRole('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'),
  async (req: Request, res: Response) => {
    const ticketId = parseTicketIdParam(String(req.params.id));
    if (ticketId === null) {
      ticketNotFound(res);
      return;
    }

    try {
      const access = await resolveTicketAccess(ticketId, req.authUser!);
      if (access.kind === 'not-found') {
        ticketNotFound(res);
        return;
      }

      // IT Staff/Administrator can already read this ticket (case 3) but
      // BR-05 reserves the resolution indication for the owning Requester
      // only — neither of them may perform it on any ticket, owned or not.
      if (access.kind === 'staff') {
        forbidden(res);
        return;
      }

      if (RESOLUTION_TERMINAL_STATUSES.has(access.ticket.status)) {
        invalidState(res);
        return;
      }

      // BR-26: records the indication and its time; the status is left
      // untouched (idempotent — a repeat call just refreshes the timestamp
      // and still returns 204).
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { requesterResolvedAt: new Date() },
      });

      res.status(204).send();
    } catch (error) {
      console.error('Error recording resolution indication:', error);
      internalError(res);
    }
  },
);
