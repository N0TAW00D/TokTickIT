import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, passwordChangeGate, requireRole } from '../middleware/authContext.ts';
import { prisma } from '../lib/prisma.ts';
import { validateActionCreateBody, validateActionUpdateShape } from '../validation/actionRules.ts';
import { hashActionCreateBody } from '../services/actionRequestHash.ts';
import {
  actionToJson,
  createAction,
  listActions,
  updateAction,
  type ActionWriteResult,
} from '../services/actionsTaken.ts';
import type { FieldError } from '../validation/ticketFields.ts';

// Actions Taken: GET/POST /api/tickets/:id/actions-taken and
// PATCH /api/tickets/:id/actions-taken/:actionId (docs/lab-04/api-spec.md §2;
// specification.md BR-01..BR-15, BR-33..BR-39). Check order is BR-34:
// 415 -> 401 -> password gate -> malformed id 404 -> body shape 400 -> access
// 404/403 -> (inside the Ticket lock) record-dependent 400 -> STALE_UPDATE ->
// business 409s.
export const actionsTakenRouter: Router = Router({ mergeParams: true });

const PG_INT4_MAX = 2_147_483_647;

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= PG_INT4_MAX ? id : null;
}

function requireJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' });
    return;
  }
  next();
}

function notFound(res: Response): void {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Ticket not found.' });
}

function forbidden(res: Response): void {
  res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have permission to perform this action.' });
}

function validationFailed(res: Response, fields: FieldError[]): void {
  res.status(400).json({ error: 'VALIDATION_FAILED', message: 'One or more fields are invalid.', fields });
}

function internalError(res: Response): void {
  res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
}

function isPlainBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/** Read path: the owning Requester, any IT Staff, any Administrator. */
async function resolveAccess(ticketId: number, user: NonNullable<Request['authUser']>) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true, requesterId: true } });
  if (!ticket) return 'not-found' as const;
  if (user.role === 'REQUESTER') return ticket.requesterId === user.id ? ('read-only' as const) : ('not-found' as const);
  return 'staff' as const;
}

/** Maps a write outcome to its HTTP response (shared by POST and PATCH). */
function respond(res: Response, result: ActionWriteResult): void {
  switch (result.kind) {
    case 'created':
      res.status(201).json(actionToJson(result.action));
      return;
    case 'replay':
      res.status(200).json(actionToJson(result.action));
      return;
    case 'updated':
      res.status(200).json(actionToJson(result.action));
      return;
    case 'not-found':
      notFound(res);
      return;
    case 'validation':
      validationFailed(res, result.errors);
      return;
    case 'stale':
      res.status(409).json({
        error: 'STALE_UPDATE',
        message: 'This record was changed by someone else. Review the current version and try again.',
        current: actionToJson(result.current),
      });
      return;
    case 'idempotency-conflict':
      res.status(409).json({
        error: 'IDEMPOTENCY_CONFLICT',
        message: 'This clientRequestId was already used on this Ticket with a different request.',
      });
      return;
    case 'ticket-closed':
      res.status(409).json({ error: 'TICKET_CLOSED', message: 'Actions Taken cannot be changed on a closed or cancelled Ticket.' });
      return;
    case 'action-locked':
      res.status(409).json({ error: 'ACTION_LOCKED', message: 'A completed or cancelled Action Taken can no longer be changed.' });
      return;
    case 'invalid-transition':
      res.status(409).json({ error: 'INVALID_ACTION_TRANSITION', message: 'That status change is not allowed for this Action Taken.' });
      return;
    case 'invalid-assignee':
      res.status(409).json({ error: 'INVALID_ASSIGNEE', message: 'The assignee must be an active IT Staff member or Administrator.' });
      return;
  }
}

const ALL_ROLES = ['REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'] as const;

actionsTakenRouter.get('/', authenticate, passwordChangeGate, requireRole(...ALL_ROLES), async (req: Request, res: Response) => {
  const ticketId = parseId(String(req.params.id));
  if (ticketId === null) {
    notFound(res);
    return;
  }
  try {
    if ((await resolveAccess(ticketId, req.authUser!)) === 'not-found') {
      notFound(res);
      return;
    }
    res.status(200).json((await listActions(ticketId)).map(actionToJson));
  } catch (error) {
    console.error('Error listing actions taken:', error);
    internalError(res);
  }
});

actionsTakenRouter.post(
  '/',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  requireRole(...ALL_ROLES),
  async (req: Request, res: Response) => {
    const ticketId = parseId(String(req.params.id));
    if (ticketId === null) {
      notFound(res);
      return;
    }
    if (!isPlainBody(req.body)) {
      res.status(400).json({ error: 'MALFORMED_BODY', message: 'Request body must be a JSON object.' });
      return;
    }
    const body = req.body;
    // BR-34: body shape 400 comes before the access lookup.
    const shape = validateActionCreateBody(body, null);
    if (!shape.ok) {
      validationFailed(res, shape.errors);
      return;
    }
    try {
      const access = await resolveAccess(ticketId, req.authUser!);
      if (access === 'not-found') {
        notFound(res);
        return;
      }
      if (access === 'read-only') {
        forbidden(res);
        return;
      }
      const result = await createAction({
        ticketId,
        actorId: req.authUser!.id,
        hash: hashActionCreateBody(body),
        validate: (ticketCreatedAt) => validateActionCreateBody(body, { ticketCreatedAt, now: new Date() }),
      });
      respond(res, result);
    } catch (error) {
      console.error('Error creating action taken:', error);
      internalError(res);
    }
  },
);

actionsTakenRouter.patch(
  '/:actionId',
  requireJsonContentType,
  authenticate,
  passwordChangeGate,
  requireRole(...ALL_ROLES),
  async (req: Request, res: Response) => {
    const ticketId = parseId(String(req.params.id));
    const actionId = parseId(String(req.params.actionId));
    if (ticketId === null || actionId === null) {
      notFound(res);
      return;
    }
    if (!isPlainBody(req.body)) {
      res.status(400).json({ error: 'MALFORMED_BODY', message: 'Request body must be a JSON object.' });
      return;
    }
    const body = req.body;
    const shapeErrors = validateActionUpdateShape(body);
    if (shapeErrors.length > 0) {
      validationFailed(res, shapeErrors);
      return;
    }
    try {
      const access = await resolveAccess(ticketId, req.authUser!);
      if (access === 'not-found') {
        notFound(res);
        return;
      }
      if (access === 'read-only') {
        forbidden(res);
        return;
      }
      respond(res, await updateAction({ ticketId, actionId, actorId: req.authUser!.id, body }));
    } catch (error) {
      console.error('Error updating action taken:', error);
      internalError(res);
    }
  },
);
