import { Router, type Request, type Response } from 'express';
import { requesterContext } from '../middleware/requesterContext.ts';
import { validateTicketFields, type FieldError } from '../validation/ticketFields.ts';
import { createTicket, ReferenceNotFoundError } from '../services/createTicket.ts';

// POST /api/tickets — api-spec.md §3.1 (BR-01, BR-02, BR-04, BR-12, BR-24,
// BR-25, BR-26, BR-28, BR-36; AC-01, AC-11..AC-14, AC-16, AC-43).
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
  // express.json() (app.ts) leaves req.body undefined for a missing/other
  // Content-Type or an unparsable body — the parse-error handler mounted
  // right after it (app.ts) catches actually-malformed JSON. What's left
  // for this route to reject is JSON that parsed fine but isn't an object
  // (e.g. an array or a bare primitive), which "strict" JSON parsing alone
  // does not rule out (§1.4).
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
