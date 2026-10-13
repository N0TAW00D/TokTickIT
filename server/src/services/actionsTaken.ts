import { prisma } from '../lib/prisma.ts';
import { Prisma } from '../generated/prisma/client.ts';
import type { ActionStatus } from '../generated/prisma/client.ts';
import {
  isActionTransitionAllowed,
  mergeActionUpdate,
  type StoredAction,
  type ValidatedCreate,
} from '../validation/actionRules.ts';
import type { FieldError } from '../validation/ticketFields.ts';

// Actions Taken persistence (docs/lab-04/api-spec.md §1.3, §1.4, §2;
// specification.md BR-12, BR-15, BR-33..BR-35, BR-39).
//
// Every write runs inside one `$transaction` that first takes the Ticket row
// lock (`SELECT ... FOR UPDATE`), then reads, compares `version`, runs the
// domain checks and only then writes - so a rejected request leaves nothing
// behind. Rules themselves live in `validation/actionRules.ts`.

export const ACTION_INCLUDE = {
  performedBy: { select: { id: true, name: true, role: true } },
  assignee: { select: { id: true, name: true } },
  lastUpdatedBy: { select: { id: true, name: true } },
} as const;

export type ActionRow = Prisma.ActionTakenGetPayload<{ include: typeof ACTION_INCLUDE }>;

/** The api-spec §2.1 shape. `clientRequestId`/`clientRequestHash` are never returned. */
export function actionToJson(a: ActionRow) {
  return {
    id: a.id,
    ticketId: a.ticketId,
    actionAt: a.actionAt,
    description: a.description,
    result: a.result,
    status: a.status,
    performedBy: a.performedBy,
    assignee: a.assignee,
    followUpRequired: a.followUpRequired,
    followUpNote: a.followUpNote,
    attachmentNotes: a.attachmentNotes,
    lastUpdatedBy: a.lastUpdatedBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    version: a.version,
  };
}

export async function listActions(ticketId: number): Promise<ActionRow[]> {
  return prisma.actionTaken.findMany({
    where: { ticketId },
    orderBy: [{ actionAt: 'asc' }, { id: 'asc' }],
    include: ACTION_INCLUDE,
  });
}

export type ActionWriteResult =
  | { kind: 'created'; action: ActionRow }
  | { kind: 'replay'; action: ActionRow }
  | { kind: 'updated'; action: ActionRow }
  | { kind: 'not-found' }
  | { kind: 'validation'; errors: FieldError[] }
  | { kind: 'stale'; current: ActionRow }
  | { kind: 'idempotency-conflict' }
  | { kind: 'ticket-closed' }
  | { kind: 'action-locked' }
  | { kind: 'invalid-transition' }
  | { kind: 'invalid-assignee' };

type Tx = Prisma.TransactionClient;

/** Takes the Ticket row lock; returns the Ticket as read under it, or null. */
async function lockTicket(tx: Tx, ticketId: number) {
  await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
  return tx.ticket.findUnique({ where: { id: ticketId }, select: { id: true, status: true, createdAt: true } });
}

const isTicketClosed = (status: string) => status === 'CLOSED' || status === 'CANCELLED';

/** BR-08: an assignee must be an active IT Staff or Administrator. */
async function assigneeIsValid(tx: Tx, assigneeId: number): Promise<boolean> {
  const user = await tx.user.findFirst({
    where: { id: assigneeId, isActive: true, role: { in: ['IT_STAFF', 'ADMINISTRATOR'] } },
    select: { id: true },
  });
  return user !== null;
}

/** BR-15: touch the Ticket's updatedAt without changing its version. */
async function touchTicket(tx: Tx, ticketId: number): Promise<void> {
  await tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function resolveIdempotentReplay(
  reader: Tx | typeof prisma,
  ticketId: number,
  clientRequestId: string,
  hash: string,
): Promise<ActionWriteResult | null> {
  const existing = await reader.actionTaken.findUnique({
    where: { ticketId_clientRequestId: { ticketId, clientRequestId } },
    include: ACTION_INCLUDE,
  });
  if (!existing) return null;
  return existing.clientRequestHash === hash ? { kind: 'replay', action: existing } : { kind: 'idempotency-conflict' };
}

/**
 * POST: lock -> idempotency -> TICKET_CLOSED -> INVALID_ASSIGNEE -> write.
 * `validate` runs the pure create rules (it needs the Ticket's createdAt, so
 * it is called with the row read under the lock); its errors become a 400.
 */
export async function createAction(params: {
  ticketId: number;
  actorId: number;
  validate: (ticketCreatedAt: Date) => { ok: true; value: ValidatedCreate } | { ok: false; errors: FieldError[] };
  hash: string;
}): Promise<ActionWriteResult> {
  const { ticketId, actorId, validate, hash } = params;

  const run = () =>
    prisma.$transaction(async (tx): Promise<ActionWriteResult> => {
      const ticket = await lockTicket(tx, ticketId);
      if (!ticket) return { kind: 'not-found' };

      const parsed = validate(ticket.createdAt);
      if (!parsed.ok) return { kind: 'validation', errors: parsed.errors };
      const value = parsed.value;

      if (value.clientRequestId !== null) {
        const replay = await resolveIdempotentReplay(tx, ticketId, value.clientRequestId, hash);
        if (replay) return replay;
      }
      if (isTicketClosed(ticket.status)) return { kind: 'ticket-closed' };
      if (value.assigneeId !== null && !(await assigneeIsValid(tx, value.assigneeId))) {
        return { kind: 'invalid-assignee' };
      }

      const action = await tx.actionTaken.create({
        data: {
          ticketId,
          actionAt: value.actionAt,
          description: value.description,
          result: value.result,
          status: value.status,
          performedById: actorId,
          lastUpdatedById: actorId,
          assigneeId: value.assigneeId,
          followUpRequired: value.followUpRequired,
          followUpNote: value.followUpNote,
          attachmentNotes: value.attachmentNotes,
          clientRequestId: value.clientRequestId,
          clientRequestHash: value.clientRequestId === null ? null : hash,
        },
        include: ACTION_INCLUDE,
      });
      await touchTicket(tx, ticketId);
      return { kind: 'created', action };
    });

  try {
    return await run();
  } catch (error) {
    // Defence in depth: the Ticket lock already serialises same-key creates,
    // but a unique violation on (ticketId, clientRequestId) must still
    // resolve to the replay/conflict answer, never a 500.
    if (!isUniqueViolation(error)) throw error;
    const result = await resolveAfterUniqueViolation(ticketId, hash, params.validate);
    if (result) return result;
    throw error;
  }
}

async function resolveAfterUniqueViolation(
  ticketId: number,
  hash: string,
  validate: (ticketCreatedAt: Date) => { ok: true; value: ValidatedCreate } | { ok: false; errors: FieldError[] },
): Promise<ActionWriteResult | null> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { createdAt: true } });
  if (!ticket) return null;
  const parsed = validate(ticket.createdAt);
  if (!parsed.ok || parsed.value.clientRequestId === null) return null;
  return resolveIdempotentReplay(prisma, ticketId, parsed.value.clientRequestId, hash);
}

/**
 * PATCH: lock -> read -> compare version -> merge/validate -> TICKET_CLOSED ->
 * ACTION_LOCKED -> INVALID_ACTION_TRANSITION -> INVALID_ASSIGNEE -> write
 * (`UPDATE ... WHERE id AND version`, belt and braces).
 */
export async function updateAction(params: {
  ticketId: number;
  actionId: number;
  actorId: number;
  body: Record<string, unknown>;
}): Promise<ActionWriteResult> {
  const { ticketId, actionId, actorId, body } = params;

  return prisma.$transaction(async (tx): Promise<ActionWriteResult> => {
    const ticket = await lockTicket(tx, ticketId);
    if (!ticket) return { kind: 'not-found' };
    const stored = await tx.actionTaken.findFirst({ where: { id: actionId, ticketId }, include: ACTION_INCLUDE });
    if (!stored) return { kind: 'not-found' };

    // `version` is shape-checked by the route before the transaction; here it
    // is compared. A body whose version is not a number cannot reach this.
    const requestedVersion = body.version as number;
    if (requestedVersion !== stored.version) return { kind: 'stale', current: stored };

    const merged = mergeActionUpdate(
      {
        description: stored.description,
        result: stored.result,
        actionAt: stored.actionAt,
        status: stored.status,
        assigneeId: stored.assigneeId,
        followUpRequired: stored.followUpRequired,
        followUpNote: stored.followUpNote,
        attachmentNotes: stored.attachmentNotes,
      } satisfies StoredAction,
      body,
      { ticketCreatedAt: ticket.createdAt, now: new Date() },
    );
    if (!merged.ok) return { kind: 'validation', errors: merged.errors };

    if (isTicketClosed(ticket.status)) return { kind: 'ticket-closed' };
    if (stored.status === 'COMPLETED' || stored.status === 'CANCELLED') return { kind: 'action-locked' };
    if (merged.transition && !isActionTransitionAllowed(merged.transition.from, merged.transition.to)) {
      return { kind: 'invalid-transition' };
    }
    if (body.assigneeId !== undefined && merged.value.assigneeId !== null) {
      if (!(await assigneeIsValid(tx, merged.value.assigneeId))) return { kind: 'invalid-assignee' };
    }

    const v = merged.value;
    const { count } = await tx.actionTaken.updateMany({
      where: { id: actionId, version: stored.version },
      data: {
        description: v.description,
        result: v.result,
        actionAt: v.actionAt,
        status: v.status as ActionStatus,
        assigneeId: v.assigneeId,
        followUpRequired: v.followUpRequired,
        followUpNote: v.followUpNote,
        attachmentNotes: v.attachmentNotes,
        lastUpdatedById: actorId,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (count === 0) {
      const current = await tx.actionTaken.findUniqueOrThrow({ where: { id: actionId }, include: ACTION_INCLUDE });
      return { kind: 'stale', current };
    }
    await touchTicket(tx, ticketId);
    const action = await tx.actionTaken.findUniqueOrThrow({ where: { id: actionId }, include: ACTION_INCLUDE });
    return { kind: 'updated', action };
  });
}
