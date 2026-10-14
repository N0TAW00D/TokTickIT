// Pure rules for Actions Taken (specification.md BR-04..BR-09, BR-33, BR-35;
// api-spec.md §2.3-2.4). DB- and Express-free: the route layer (and the
// transaction that holds the Ticket lock) supplies the stored Action, the
// Ticket's createdAt and the clock, and turns the returned `errors` into a
// `400 VALIDATION_FAILED` body. Transition legality is NOT a 400 - the route
// answers `409 INVALID_ACTION_TRANSITION` using `isActionTransitionAllowed`
// and the `transition` that `mergeActionUpdate` reports.

import type { FieldError, FieldResult } from './ticketFields.ts';

export const ACTION_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Statuses a new Action may start in (BR-09). */
const INITIAL_STATUSES: readonly ActionStatus[] = ['PLANNED', 'IN_PROGRESS', 'COMPLETED'];

const DESCRIPTION_MAX = 2000;
const RESULT_MAX = 2000;
const FOLLOW_UP_NOTE_MAX = 1000;
const ATTACHMENT_NOTES_MAX = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// ISO 8601 date-time that carries an explicit offset (api-spec §2.3).
const ISO_WITH_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

export interface StoredAction {
  description: string;
  result: string | null;
  actionAt: Date;
  status: ActionStatus;
  assigneeId: number | null;
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
}

export interface ActionRuleContext {
  /** The owning Ticket's createdAt: actionAt may not precede it (BR-04). */
  ticketCreatedAt: Date;
  /** Injected clock: server "now". */
  now: Date;
}

export interface ValidatedCreate extends StoredAction {
  clientRequestId: string | null;
}

export type RulesResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };
export type UpdateResult =
  | {
      ok: true;
      version: number;
      value: StoredAction;
      /** The requested status change, or null when the body carried no status. */
      transition: { from: ActionStatus; to: ActionStatus } | null;
    }
  | { ok: false; errors: FieldError[] };

type Body = Record<string, unknown>;

function fail<T>(field: string, message: string): FieldResult<T> {
  return { ok: false, error: { field, message } };
}

function isBlank(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

/** `description`: required, 1-2000 after trim (BR-05). */
export function validateActionDescription(raw: unknown): FieldResult<string> {
  if (typeof raw !== 'string') return fail('description', 'description is required.');
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > DESCRIPTION_MAX) {
    return fail('description', `description must be between 1 and ${DESCRIPTION_MAX} characters after trimming.`);
  }
  return { ok: true, value: trimmed };
}

/**
 * `result`: absent / null / blank = none (`null`); otherwise 1-2000 after
 * trim (BR-05). Whether a result is *required* depends on the status and is
 * checked by the create/merge functions.
 */
export function validateActionResult(raw: unknown): FieldResult<string | null> {
  if (isBlank(raw)) return { ok: true, value: null };
  if (typeof raw !== 'string') return fail('result', 'result must be text.');
  const trimmed = raw.trim();
  if (trimmed.length > RESULT_MAX) {
    return fail('result', `result must be at most ${RESULT_MAX} characters after trimming.`);
  }
  return { ok: true, value: trimmed };
}

/** `attachmentNotes`: optional text <= 500, absent/null/blank = none (BR-07). */
export function validateAttachmentNotes(raw: unknown): FieldResult<string | null> {
  if (isBlank(raw)) return { ok: true, value: null };
  if (typeof raw !== 'string') return fail('attachmentNotes', 'attachmentNotes must be text.');
  const trimmed = raw.trim();
  if (trimmed.length > ATTACHMENT_NOTES_MAX) {
    return fail('attachmentNotes', `attachmentNotes must be at most ${ATTACHMENT_NOTES_MAX} characters.`);
  }
  return { ok: true, value: trimmed };
}

/**
 * Flag + note pair (BR-06): flag on needs a 1-1000 trimmed note; flag off
 * needs the note absent/null. `flag` undefined means the default, false.
 */
export function validateFollowUp(
  flag: unknown,
  note: unknown,
): FieldResult<{ followUpRequired: boolean; followUpNote: string | null }> {
  if (flag !== undefined && typeof flag !== 'boolean') {
    return fail('followUpRequired', 'followUpRequired must be true or false.');
  }
  const followUpRequired = flag === true;
  if (!followUpRequired) {
    if (note !== undefined && note !== null) {
      return fail('followUpNote', 'followUpNote must be empty when followUpRequired is false.');
    }
    return { ok: true, value: { followUpRequired: false, followUpNote: null } };
  }
  if (typeof note !== 'string' || note.trim() === '') {
    return fail('followUpNote', 'followUpNote is required when followUpRequired is true.');
  }
  const trimmed = note.trim();
  if (trimmed.length > FOLLOW_UP_NOTE_MAX) {
    return fail('followUpNote', `followUpNote must be at most ${FOLLOW_UP_NOTE_MAX} characters.`);
  }
  return { ok: true, value: { followUpRequired: true, followUpNote: trimmed } };
}

/** `version`: required positive integer (BR-33). */
export function validateVersion(raw: unknown): FieldResult<number> {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return fail('version', 'version is required and must be a positive integer.');
  }
  return { ok: true, value: raw };
}

/** `clientRequestId`: optional UUID string (BR-35); omitted/null -> `null`. */
export function validateClientRequestId(raw: unknown): FieldResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    return fail('clientRequestId', 'clientRequestId must be a UUID v4.');
  }
  return { ok: true, value: raw };
}

/** `assigneeId`: shape only - integer or null. Role/active check is the DB's (BR-08). */
export function validateAssigneeId(raw: unknown): FieldResult<number | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return fail('assigneeId', 'assigneeId must be an integer or null.');
  }
  return { ok: true, value: raw };
}

/** Status lifecycle (BR-09): the only legal moves; no-ops are rejected. */
export function isActionTransitionAllowed(from: ActionStatus, to: ActionStatus): boolean {
  return (
    (from === 'PLANNED' && (to === 'IN_PROGRESS' || to === 'CANCELLED')) ||
    (from === 'IN_PROGRESS' && (to === 'COMPLETED' || to === 'CANCELLED'))
  );
}

function parseInstant(raw: unknown): FieldResult<Date> {
  if (typeof raw !== 'string' || !ISO_WITH_OFFSET_RE.test(raw)) {
    return fail('actionAt', 'actionAt must be an ISO 8601 date-time with an offset.');
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return fail('actionAt', 'actionAt must be a valid date-time.');
  return { ok: true, value: d };
}

/**
 * `actionAt` bounds (BR-04): not before the Ticket's createdAt; not after
 * `now` unless the status is PLANNED. Applied to an already-parsed instant so
 * the merge path can re-check a stored value against a new status.
 */
export function checkActionAtBounds(
  actionAt: Date,
  status: ActionStatus,
  ctx: ActionRuleContext,
): FieldResult<Date> {
  if (actionAt.getTime() < ctx.ticketCreatedAt.getTime()) {
    return fail('actionAt', "actionAt cannot be before the Ticket's creation time.");
  }
  if (status !== 'PLANNED' && actionAt.getTime() > ctx.now.getTime()) {
    return fail('actionAt', 'actionAt cannot be in the future unless the Action is Planned.');
  }
  return { ok: true, value: actionAt };
}

function parseStatus(raw: unknown, allowed: readonly ActionStatus[]): FieldResult<ActionStatus> {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    return fail('status', `status must be one of ${allowed.join(', ')}.`);
  }
  return { ok: true, value: raw as ActionStatus };
}

/** A COMPLETED Action must carry a result (BR-05, D-16). */
function requireResultToComplete(status: ActionStatus, result: string | null): FieldResult<null> {
  if (status === 'COMPLETED' && result === null) {
    return fail('result', 'result is required to complete an Action.');
  }
  return { ok: true, value: null };
}

function collect(errors: FieldError[], r: FieldResult<unknown>): void {
  if (!r.ok) errors.push(r.error);
}

/**
 * Validates a POST body (api-spec §2.3). Server-owned keys are ignored.
 * `actionAt` defaults to `ctx.now`. Collects every field error. Pass
 * `ctx = null` for the shape-only pass that runs before the access lookup
 * (BR-34); the full pass then adds the record-dependent `actionAt` bounds.
 */
export function validateActionCreateBody(body: Body, ctx: ActionRuleContext | null): RulesResult<ValidatedCreate> {
  const errors: FieldError[] = [];

  const description = validateActionDescription(body.description);
  collect(errors, description);

  const status = body.status === undefined ? ({ ok: true, value: 'PLANNED' } as const)
    : parseStatus(body.status, INITIAL_STATUSES);
  collect(errors, status);

  const result = validateActionResult(body.result);
  collect(errors, result);
  if (status.ok && result.ok) collect(errors, requireResultToComplete(status.value, result.value));

  let actionAt: Date | null = null;
  if (body.actionAt === undefined || body.actionAt === null) {
    actionAt = ctx ? ctx.now : new Date(0);
  } else {
    const parsed = parseInstant(body.actionAt);
    if (!parsed.ok) errors.push(parsed.error);
    else actionAt = parsed.value;
  }
  // `ctx === null` is the shape-only pass (BR-34): the bounds need the Ticket.
  if (ctx && actionAt && status.ok) collect(errors, checkActionAtBounds(actionAt, status.value, ctx));

  const assignee = validateAssigneeId(body.assigneeId);
  collect(errors, assignee);
  const followUp = validateFollowUp(body.followUpRequired, body.followUpNote);
  collect(errors, followUp);
  const attachmentNotes = validateAttachmentNotes(body.attachmentNotes);
  collect(errors, attachmentNotes);
  const clientRequestId = validateClientRequestId(body.clientRequestId);
  collect(errors, clientRequestId);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      description: (description as { value: string }).value,
      result: (result as { value: string | null }).value,
      actionAt: actionAt as Date,
      status: (status as { value: ActionStatus }).value,
      assigneeId: (assignee as { value: number | null }).value,
      followUpRequired: (followUp as { value: { followUpRequired: boolean } }).value.followUpRequired,
      followUpNote: (followUp as { value: { followUpNote: string | null } }).value.followUpNote,
      attachmentNotes: (attachmentNotes as { value: string | null }).value,
      clientRequestId: (clientRequestId as { value: string | null }).value,
    },
  };
}

/**
 * Shape-only check of a PATCH body (BR-34: runs before the access lookup, so
 * nothing here may need the stored Action). Everything that depends on the
 * stored state - the follow-up pair, a result required to complete, the
 * `actionAt` bounds - is judged later by `mergeActionUpdate`.
 */
export function validateActionUpdateShape(body: Body): FieldError[] {
  const errors: FieldError[] = [];
  collect(errors, validateVersion(body.version));
  if (!UPDATABLE.some((k) => k in body && body[k] !== undefined)) {
    errors.push({ field: 'body', message: 'At least one field to change is required.' });
  }
  const has = (k: (typeof UPDATABLE)[number]) => body[k] !== undefined;
  if (has('description')) collect(errors, validateActionDescription(body.description));
  if (has('status')) collect(errors, parseStatus(body.status, ACTION_STATUSES));
  if (has('result')) collect(errors, validateActionResult(body.result));
  if (has('actionAt')) collect(errors, parseInstant(body.actionAt));
  if (has('assigneeId')) collect(errors, validateAssigneeId(body.assigneeId));
  if (has('attachmentNotes')) collect(errors, validateAttachmentNotes(body.attachmentNotes));
  if (has('followUpRequired') && typeof body.followUpRequired !== 'boolean') {
    errors.push({ field: 'followUpRequired', message: 'followUpRequired must be true or false.' });
  }
  if (has('followUpNote') && body.followUpNote !== null) {
    if (typeof body.followUpNote !== 'string') {
      errors.push({ field: 'followUpNote', message: 'followUpNote must be text.' });
    } else if (body.followUpNote.trim().length > FOLLOW_UP_NOTE_MAX) {
      errors.push({ field: 'followUpNote', message: `followUpNote must be at most ${FOLLOW_UP_NOTE_MAX} characters.` });
    }
  }
  return errors;
}

const UPDATABLE = [
  'description',
  'result',
  'actionAt',
  'status',
  'assigneeId',
  'followUpRequired',
  'followUpNote',
  'attachmentNotes',
] as const;

/**
 * Validates a PATCH body against the stored Action and returns the merged
 * result (api-spec §2.4). `version` is required; at least one updatable key
 * must be present. Keys left out keep their stored value, except that turning
 * `followUpRequired` off clears the stored note (BR-06). Validation runs on
 * the merged state, so a transition to COMPLETED is satisfied by a stored
 * result and a future-dated PLANNED Action cannot move to IN_PROGRESS /
 * COMPLETED. The status pair itself is not judged here (409, not 400).
 */
export function mergeActionUpdate(stored: StoredAction, body: Body, ctx: ActionRuleContext): UpdateResult {
  const errors: FieldError[] = [];

  const version = validateVersion(body.version);
  collect(errors, version);
  if (!UPDATABLE.some((k) => k in body && body[k] !== undefined)) {
    errors.push({ field: 'body', message: 'At least one field to change is required.' });
  }

  const has = (k: (typeof UPDATABLE)[number]) => body[k] !== undefined;

  let description = stored.description;
  if (has('description')) {
    const r = validateActionDescription(body.description);
    if (r.ok) description = r.value;
    else errors.push(r.error);
  }

  let status = stored.status;
  let transition: { from: ActionStatus; to: ActionStatus } | null = null;
  if (has('status')) {
    const r = parseStatus(body.status, ACTION_STATUSES);
    if (r.ok) {
      status = r.value;
      transition = { from: stored.status, to: r.value };
    } else errors.push(r.error);
  }

  let result = stored.result;
  if (has('result')) {
    const r = validateActionResult(body.result);
    if (r.ok) result = r.value;
    else errors.push(r.error);
  }
  collect(errors, requireResultToComplete(status, result));

  let actionAt = stored.actionAt;
  if (has('actionAt')) {
    const r = parseInstant(body.actionAt);
    if (r.ok) actionAt = r.value;
    else errors.push(r.error);
  }
  if (!errors.some((e) => e.field === 'actionAt')) {
    collect(errors, checkActionAtBounds(actionAt, status, ctx));
  }

  let assigneeId = stored.assigneeId;
  if (has('assigneeId')) {
    const r = validateAssigneeId(body.assigneeId);
    if (r.ok) assigneeId = r.value;
    else errors.push(r.error);
  }

  const flag = has('followUpRequired') ? body.followUpRequired : stored.followUpRequired;
  let note: unknown;
  if (has('followUpNote')) note = body.followUpNote;
  else note = flag === false ? null : stored.followUpNote;
  const followUp = validateFollowUp(flag, note);
  collect(errors, followUp);

  let attachmentNotes = stored.attachmentNotes;
  if (has('attachmentNotes')) {
    const r = validateAttachmentNotes(body.attachmentNotes);
    if (r.ok) attachmentNotes = r.value;
    else errors.push(r.error);
  }

  if (errors.length > 0 || !version.ok || !followUp.ok) return { ok: false, errors };
  return {
    ok: true,
    version: version.value,
    transition,
    value: {
      description,
      result,
      actionAt,
      status,
      assigneeId,
      followUpRequired: followUp.value.followUpRequired,
      followUpNote: followUp.value.followUpNote,
      attachmentNotes,
    },
  };
}
