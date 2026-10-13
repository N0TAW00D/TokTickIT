import { createHash } from 'node:crypto';

// Idempotency hash for POST /api/tickets/:id/actions-taken
// (docs/lab-04/api-spec.md §1.4 and §2.3, specification.md BR-35).
//
// Framework-free on purpose: the create route and the seed both use it.
//
// The canonical form contains only the client-controllable create-body
// fields. Server-owned fields (performedBy, createdAt, lastUpdatedBy,
// ticketId, id, version) and clientRequestId itself are ignored. Text is
// trimmed and an empty optional text becomes null; defaults are applied
// (status PLANNED, followUpRequired false, every optional field null);
// actionAt is normalised to ISO-8601 UTC, or null when the client omitted it
// (the server's "now" default would make a genuine retry hash differently).
// Keys are in fixed alphabetical order.

type Body = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function instant(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export function canonicaliseActionCreateBody(body: Body): string {
  const followUpRequired = body.followUpRequired === true;
  const canonical = {
    actionAt: instant(body.actionAt),
    assigneeId: typeof body.assigneeId === 'number' ? body.assigneeId : null,
    attachmentNotes: text(body.attachmentNotes),
    description: text(body.description) ?? '',
    followUpNote: followUpRequired ? text(body.followUpNote) : null,
    followUpRequired,
    result: text(body.result),
    status: typeof body.status === 'string' && body.status !== '' ? body.status : 'PLANNED',
  };
  return JSON.stringify(canonical);
}

export function hashActionCreateBody(body: Body): string {
  return createHash('sha256').update(canonicaliseActionCreateBody(body)).digest('hex');
}
