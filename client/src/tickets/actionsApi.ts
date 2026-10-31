const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/** Action Taken lifecycle (lab-04/specification.md BR-09). */
export type ActionStatus =
  | "PLANNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

/** One Action Taken (lab-04/api-spec.md §2.1). `clientRequestId` is never returned. */
export interface ActionTaken {
  id: number;
  ticketId: number;
  actionAt: string;
  description: string;
  result: string | null;
  status: ActionStatus;
  performedBy: { id: number; name: string; role: string };
  assignee: { id: number; name: string } | null;
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
  lastUpdatedBy: { id: number; name: string };
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Fields of the create body the form sends (api-spec.md §2.3). */
export interface CreateActionInput {
  description: string;
  result?: string | null;
  actionAt?: string;
  status?: ActionStatus;
  assigneeId?: number | null;
  followUpRequired?: boolean;
  followUpNote?: string | null;
  attachmentNotes?: string | null;
  clientRequestId?: string;
}

/** Any subset of the editable fields plus the required `version` (api-spec.md §2.4). */
export type UpdateActionInput = Partial<
  Omit<CreateActionInput, "clientRequestId">
> & { version: number };

export interface ActionFieldError {
  field: string;
  message: string;
}

/** What went wrong with an Action write, coarse enough for the UI to branch on. */
export type ActionWriteErrorKind =
  | "validation"
  | "stale"
  | "locked"
  | "invalid-transition"
  | "invalid-assignee"
  | "ticket-closed"
  | "idempotency"
  | "not-found"
  | "forbidden"
  | "failure";

/** Thrown by `createAction` / `updateAction` on any non-2xx or network failure; carries parsed
 * `fields` (400) or the `current` Action (`STALE_UPDATE`), never raw server text. */
export class ActionWriteError extends Error {
  readonly kind: ActionWriteErrorKind;
  readonly fields: ActionFieldError[];
  readonly current: ActionTaken | null;

  constructor(
    kind: ActionWriteErrorKind,
    options: { fields?: ActionFieldError[]; current?: ActionTaken | null } = {},
  ) {
    super(`Action write failed (${kind}).`);
    this.name = "ActionWriteError";
    this.kind = kind;
    this.fields = options.fields ?? [];
    this.current = options.current ?? null;
  }
}

/** The list answered 404: the Ticket is not readable (e.g. it no longer exists). */
export class ActionsNotFoundError extends Error {
  constructor() {
    super("Actions Taken not found.");
    this.name = "ActionsNotFoundError";
  }
}

/** `GET /api/tickets/:id/actions-taken`: oldest first (BR-14); `[]` when none. */
export async function fetchActions(ticketId: number): Promise<ActionTaken[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/tickets/${ticketId}/actions-taken`,
    { credentials: "include" },
  );
  if (response.status === 404) throw new ActionsNotFoundError();
  if (!response.ok) {
    throw new Error(`Failed to load actions taken (status ${response.status})`);
  }
  return response.json();
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toFieldErrors(value: unknown): ActionFieldError[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ActionFieldError =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).field === "string" &&
      typeof (entry as Record<string, unknown>).message === "string",
  );
}

const CONFLICT_KIND: Record<string, ActionWriteErrorKind> = {
  STALE_UPDATE: "stale",
  ACTION_LOCKED: "locked",
  INVALID_ACTION_TRANSITION: "invalid-transition",
  INVALID_ASSIGNEE: "invalid-assignee",
  TICKET_CLOSED: "ticket-closed",
  IDEMPOTENCY_CONFLICT: "idempotency",
};

async function sendWrite(
  url: string,
  method: "POST" | "PATCH",
  payload: unknown,
): Promise<ActionTaken> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ActionWriteError("failure");
  }

  if (response.ok) return response.json();

  const body = await readBody(response);
  if (response.status === 400) {
    throw new ActionWriteError("validation", {
      fields: toFieldErrors(body.fields),
    });
  }
  if (response.status === 409) {
    const kind = CONFLICT_KIND[String(body.error)] ?? "failure";
    const current =
      kind === "stale" && typeof body.current === "object" && body.current
        ? (body.current as ActionTaken)
        : null;
    throw new ActionWriteError(kind, { current });
  }
  if (response.status === 404) throw new ActionWriteError("not-found");
  if (response.status === 403) throw new ActionWriteError("forbidden");
  throw new ActionWriteError("failure");
}

/** `POST /api/tickets/:id/actions-taken` (api-spec.md §2.3); a repeated `clientRequestId` returns the existing Action. */
export function createAction(
  ticketId: number,
  input: CreateActionInput,
): Promise<ActionTaken> {
  return sendWrite(
    `${API_BASE_URL}/api/tickets/${ticketId}/actions-taken`,
    "POST",
    input,
  );
}

/** `PATCH /api/tickets/:id/actions-taken/:actionId` (api-spec.md §2.4), guarded by `version`. */
export function updateAction(
  ticketId: number,
  actionId: number,
  input: UpdateActionInput,
): Promise<ActionTaken> {
  return sendWrite(
    `${API_BASE_URL}/api/tickets/${ticketId}/actions-taken/${actionId}`,
    "PATCH",
    input,
  );
}
