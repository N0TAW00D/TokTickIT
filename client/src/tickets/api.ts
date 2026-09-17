const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export interface ReferenceOption {
  id: number;
  name: string;
}

/**
 * `GET /api/categories` (api-spec.md §2.1): active ticket categories for
 * the Create Ticket classification control. Not Requester-scoped.
 */
export async function fetchCategories(): Promise<ReferenceOption[]> {
  const response = await fetch(`${API_BASE_URL}/api/categories`);
  if (!response.ok) {
    throw new Error(`Failed to load categories (status ${response.status})`);
  }
  return response.json();
}

/**
 * `GET /api/related-systems` (api-spec.md §2.2): active related systems.
 * Not Requester-scoped.
 */
export async function fetchRelatedSystems(): Promise<ReferenceOption[]> {
  const response = await fetch(`${API_BASE_URL}/api/related-systems`);
  if (!response.ok) {
    throw new Error(
      `Failed to load related systems (status ${response.status})`,
    );
  }
  return response.json();
}

export type RequestedPriority = "LOW" | "MEDIUM" | "HIGH";

export interface CreateTicketRequest {
  categoryId: number;
  relatedSystemId: number;
  requestedPriority: RequestedPriority;
  summary: string;
  description: string;
}

/**
 * One attachment as it appears in a ticket's `attachments[]` (api-spec.md
 * §3.3): both active and soft-removed rows use this same shape. Removed
 * rows carry `removedAt`/`removedReason`; active rows carry `null` for
 * both (BR-33).
 */
export interface TicketAttachment {
  id: number;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  isRemoved: boolean;
  removedAt: string | null;
  removedReason: string | null;
  createdAt: string;
}

export interface CreateTicketResponse {
  id: number;
  ticketNumber: string;
  requester: { id: number; name: string; email: string };
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
  requestedPriority: RequestedPriority;
  status: string;
  summary: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  attachments: TicketAttachment[];
}

/** One `{ field, message }` entry from a `VALIDATION_FAILED` body (api-spec.md §1.3). */
export interface CreateTicketFieldError {
  field: string;
  message: string;
}

/**
 * Thrown by `createTicket` when the server responds `400 VALIDATION_FAILED`
 * (api-spec.md §1.3, §3.1) — carries the `fields[]` the server rejected so
 * the caller can show per-field messages instead of a generic failure.
 */
export class CreateTicketValidationError extends Error {
  readonly fields: CreateTicketFieldError[];

  constructor(fields: CreateTicketFieldError[]) {
    super("Ticket creation failed validation.");
    this.name = "CreateTicketValidationError";
    this.fields = fields;
  }
}

function isFieldError(value: unknown): value is CreateTicketFieldError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).field === "string" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

/**
 * Best-effort parse of an error response body (api-spec.md §1.3). The body
 * may be absent, not JSON, or shaped unexpectedly — none of that should
 * throw; callers fall back to the generic failure path instead.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export type TicketSortField = "createdAt" | "updatedAt" | "ticketNumber";
export type SortOrder = "asc" | "desc";
export type TicketPageSize = 10 | 20 | 50;

/** One row of `GET /api/tickets` (api-spec.md §3.2). */
export interface TicketListItem {
  id: number;
  ticketNumber: string;
  summary: string;
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
  requestedPriority: RequestedPriority;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Non-removed attachments only (api-spec.md §3.2). */
  activeAttachmentCount: number;
}

export interface TicketListMeta {
  page: number;
  pageSize: TicketPageSize;
  totalItems: number;
  totalPages: number;
  sort: TicketSortField;
  order: SortOrder;
}

export interface TicketListResponse {
  items: TicketListItem[];
  meta: TicketListMeta;
}

/**
 * Query params for `GET /api/tickets` (api-spec.md §3.2). All optional —
 * an absent field is simply not sent, and the server applies its own
 * default (`sort=createdAt`, `order=desc`, `page=1`, `pageSize=10`).
 *
 * This slice (Issue #18 part 1) only wires those defaults; search/filter/
 * sort/page controls that populate these fields belong to the next slice.
 */
export interface FetchMyTicketsParams {
  search?: string;
  categoryId?: number;
  priority?: RequestedPriority;
  status?: string;
  sort?: TicketSortField;
  order?: SortOrder;
  page?: number;
  pageSize?: TicketPageSize;
}

/**
 * `GET /api/tickets` (api-spec.md §3.2): the calling Requester's own
 * tickets, identified via the session cookie (`credentials: "include"`,
 * api-spec.md §1.2) — never scoped by anything sent in the query.
 *
 * A blank/whitespace-only `search` is dropped rather than sent, matching
 * the server's own "blank search ⇒ ignored" rule (BR-16) so an empty
 * string can't accidentally override the server default differently from
 * omitting the param entirely.
 */
export async function fetchMyTickets(
  params: FetchMyTicketsParams = {},
): Promise<TicketListResponse> {
  const query = new URLSearchParams();
  const trimmedSearch = params.search?.trim();
  if (trimmedSearch) query.set("search", trimmedSearch);
  if (params.categoryId !== undefined) {
    query.set("categoryId", String(params.categoryId));
  }
  if (params.priority !== undefined) query.set("priority", params.priority);
  if (params.status !== undefined) query.set("status", params.status);
  if (params.sort !== undefined) query.set("sort", params.sort);
  if (params.order !== undefined) query.set("order", params.order);
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.pageSize !== undefined) {
    query.set("pageSize", String(params.pageSize));
  }

  const queryString = query.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/tickets${queryString ? `?${queryString}` : ""}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`Failed to load tickets (status ${response.status})`);
  }
  return response.json();
}

/**
 * `GET /api/tickets/:id` (api-spec.md §3.3) response: same shape as the
 * `POST /api/tickets` `201` body, plus a populated `attachments` array and
 * (Lab 3) `owner`/`requesterResolvedAt` — `owner` is `null` when
 * unassigned (ui-spec.md §7: rendered as "Unassigned"); `itPriority` is
 * deliberately never included for a Requester caller (api-spec.md §9), so
 * it is optional here rather than nullable — the key is simply absent from
 * that response, never sent as `null`. IT Staff/Administrator callers
 * (api-spec.md §5) do get it.
 */
export interface TicketDetailResponse extends CreateTicketResponse {
  owner: { id: number; name: string } | null;
  requesterResolvedAt: string | null;
  itPriority?: RequestedPriority;
}

/**
 * Thrown by `fetchTicketDetail` on a `404` (api-spec.md §3.3). An unknown
 * `id` and a ticket owned by another Requester are answered identically
 * (BR-14, BR-42) — this error carries no detail beyond "not found" so
 * callers can't accidentally leak the distinction.
 */
export class TicketNotFoundError extends Error {
  constructor() {
    super("Ticket not found.");
    this.name = "TicketNotFoundError";
  }
}

/**
 * `GET /api/tickets/:id` (api-spec.md §3.3): one ticket owned by the
 * calling Requester, identified via the session cookie
 * (`credentials: "include"`) exactly like `createTicket`/`fetchMyTickets`.
 *
 * A `404` raises `TicketNotFoundError`; every other failure (network error,
 * 400, 500) raises a generic `Error`.
 */
export async function fetchTicketDetail(
  ticketId: number,
): Promise<TicketDetailResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickets/${ticketId}`, {
    credentials: "include",
  });
  if (response.status === 404) {
    throw new TicketNotFoundError();
  }
  if (!response.ok) {
    throw new Error(`Failed to load ticket (status ${response.status})`);
  }
  return response.json();
}

/**
 * `POST /api/tickets` (api-spec.md §3.1): create one ticket for the current
 * Requester, identified via the session cookie (`credentials: "include"`)
 * rather than the request body.
 *
 * A `400 VALIDATION_FAILED` response raises `CreateTicketValidationError`
 * with its `fields[]` preserved; every other failure (network error, 5xx,
 * or a `400` of a different `error` code) raises a generic `Error`.
 */
export async function createTicket(
  payload: CreateTicketRequest,
): Promise<CreateTicketResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickets`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    if (response.status === 400) {
      const body = await readErrorBody(response);
      if (
        typeof body === "object" &&
        body !== null &&
        (body as Record<string, unknown>).error === "VALIDATION_FAILED" &&
        Array.isArray((body as Record<string, unknown>).fields)
      ) {
        const fields = ((body as Record<string, unknown>).fields as unknown[]).filter(
          isFieldError,
        );
        throw new CreateTicketValidationError(fields);
      }
    }
    throw new Error(`Failed to create ticket (status ${response.status})`);
  }
  return response.json();
}

/**
 * One uploaded attachment, per the `POST /api/tickets/:id/attachments`
 * `201` body (api-spec.md §4.1) — the same shape as `TicketAttachment`
 * plus `ticketId`, which only the upload/metadata endpoints (§4.1, §4.2)
 * include (the `GET /api/tickets/:id` attachments[] entries in §3.3 do
 * not).
 */
export interface AttachmentResponse extends TicketAttachment {
  ticketId: number;
}

/**
 * The three distinct rejection reasons `uploadAttachment` can raise, one per
 * server rule (api-spec.md §4.1 constraints table): `415` type mismatch,
 * `413` size, `409` the 5-active-attachment ceiling. Every other failure
 * (network error, `404`, `400 NO_FILE`, `5xx`) raises a plain `Error`
 * instead — those are not attachment-specific rules the caller needs to
 * branch on.
 */
export type UploadAttachmentErrorCode =
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "ATTACHMENT_LIMIT";

/**
 * Thrown by `uploadAttachment` for the three server rules above, so a
 * caller can tell "wrong type" from "too big" from "ticket already has 5
 * active attachments" instead of catching one generic `Error` for all
 * three (api-spec.md §4.1, BR-21..BR-23, AC-18..AC-20).
 */
export class UploadAttachmentError extends Error {
  readonly code: UploadAttachmentErrorCode;

  constructor(code: UploadAttachmentErrorCode, message: string) {
    super(message);
    this.name = "UploadAttachmentError";
    this.code = code;
  }
}

/**
 * The error body's safe `message` string (api-spec.md §1.3), or `undefined`
 * when the body is absent, not JSON, or missing the field. Never throws.
 */
function extractSafeMessage(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).message === "string"
  ) {
    return (body as Record<string, unknown>).message as string;
  }
  return undefined;
}

/**
 * Best-effort read of the error body's safe `message` (api-spec.md §1.3).
 * Falls back to a generic status-coded message when the body is absent,
 * not JSON, or missing the field — never throws.
 */
function readErrorMessage(body: unknown, status: number): string {
  return (
    extractSafeMessage(body) ??
    `Failed to upload attachment (status ${status}).`
  );
}

/**
 * `POST /api/tickets/:id/attachments` (api-spec.md §4.1): upload one file
 * to a ticket owned by the calling Requester, identified via the session
 * cookie (`credentials: "include"`) exactly like `createTicket` above.
 *
 * The request body is `multipart/form-data` with a single `file` part —
 * `Content-Type` (including its boundary) is left for the browser/runtime
 * to set from the `FormData` body; setting it manually would drop the
 * boundary and break parsing server-side.
 *
 * `415`/`413`/`409` raise the matching `UploadAttachmentError` code; every
 * other failure (network error, `404`, `400 NO_FILE`, `5xx`) raises a
 * generic `Error`.
 */
export async function uploadAttachment(
  ticketId: number,
  file: File,
): Promise<AttachmentResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE_URL}/api/tickets/${ticketId}/attachments`,
    {
      method: "POST",
      credentials: "include",
      body: formData,
    },
  );

  if (!response.ok) {
    const body = await readErrorBody(response);
    const message = readErrorMessage(body, response.status);

    if (response.status === 415) {
      throw new UploadAttachmentError("UNSUPPORTED_TYPE", message);
    }
    if (response.status === 413) {
      throw new UploadAttachmentError("FILE_TOO_LARGE", message);
    }
    if (response.status === 409) {
      throw new UploadAttachmentError("ATTACHMENT_LIMIT", message);
    }
    throw new Error(`Failed to upload attachment (status ${response.status})`);
  }

  return response.json();
}

/** One `{ field, message }` entry from a `VALIDATION_FAILED` body on the removal endpoint (api-spec.md §4.4). */
export type RemoveAttachmentFieldError = CreateTicketFieldError;

/**
 * The two distinct rejection reasons `removeAttachment` can raise, one per
 * server rule (api-spec.md §4.4 errors table): `400 VALIDATION_FAILED`
 * (the `reason` failed the 3–200-trimmed-chars rule) and `409
 * ALREADY_REMOVED` (the attachment was already soft-removed, e.g. by a
 * concurrent request). Every other failure (network error, `404`, `5xx`)
 * raises a plain `Error` instead — mirrors `UploadAttachmentError` above
 * and the same 415/413/409-distinguishing pattern from PR #40.
 */
export type RemoveAttachmentErrorCode = "VALIDATION_FAILED" | "ALREADY_REMOVED";

/**
 * Thrown by `removeAttachment` for the two server rules above, so a caller
 * can tell "bad reason" (stays on the field, dialog stays open — AC-35)
 * from "already removed" (a conflict, not a field problem) instead of
 * catching one generic `Error` for both (api-spec.md §4.4, BR-31, BR-32,
 * AC-34, AC-35).
 */
export class RemoveAttachmentError extends Error {
  readonly code: RemoveAttachmentErrorCode;
  readonly fields?: RemoveAttachmentFieldError[];

  constructor(
    code: RemoveAttachmentErrorCode,
    message: string,
    fields?: RemoveAttachmentFieldError[],
  ) {
    super(message);
    this.name = "RemoveAttachmentError";
    this.code = code;
    this.fields = fields;
  }
}

/**
 * `DELETE /api/attachments/:id` (api-spec.md §4.4): soft-remove one
 * attachment on a ticket owned by the calling Requester, identified via
 * the session cookie (`credentials: "include"`) exactly like
 * `uploadAttachment` above. `reason` is sent as-is (trimmed) — the caller
 * (the Remove dialog) is expected to have already validated it
 * client-side so this request is only made once it passes.
 *
 * `400 VALIDATION_FAILED` and `409 ALREADY_REMOVED` raise the matching
 * `RemoveAttachmentError` code; every other failure (network error,
 * `404`, `5xx`) raises a generic `Error`.
 */
export async function removeAttachment(
  attachmentId: number,
  reason: string,
): Promise<TicketAttachment> {
  const response = await fetch(
    `${API_BASE_URL}/api/attachments/${attachmentId}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason }),
    },
  );

  if (!response.ok) {
    const body = await readErrorBody(response);
    const message = readErrorMessage(body, response.status);

    if (response.status === 400) {
      const fields =
        typeof body === "object" &&
        body !== null &&
        (body as Record<string, unknown>).error === "VALIDATION_FAILED" &&
        Array.isArray((body as Record<string, unknown>).fields)
          ? ((body as Record<string, unknown>).fields as unknown[]).filter(
              isFieldError,
            )
          : undefined;
      throw new RemoveAttachmentError("VALIDATION_FAILED", message, fields);
    }
    if (response.status === 409) {
      throw new RemoveAttachmentError("ALREADY_REMOVED", message);
    }
    throw new Error(`Failed to remove attachment (status ${response.status})`);
  }

  return response.json();
}

/**
 * Pulls the download filename out of a `Content-Disposition` header
 * (api-spec.md §4.3 serves `attachment; filename="<originalFilename>"`).
 * Also understands the RFC 5987 `filename*=UTF-8''...` form some servers
 * emit. Returns `null` when the header is absent or carries no filename —
 * the caller then falls back to the attachment's own `originalFilename`.
 */
export function filenameFromContentDisposition(
  header: string | null | undefined,
): string | null {
  if (!header) return null;

  const extended = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (extended?.[1]) {
    const raw = extended[1].trim().replace(/^["']|["']$/g, "");
    try {
      return decodeURIComponent(raw);
    } catch {
      // Malformed percent-encoding — fall through to the plain form.
    }
  }

  const plain = /filename\s*=\s*("?)([^";]+)\1/i.exec(header);
  if (plain?.[2]) return plain[2].trim();

  return null;
}

/**
 * Thrown by `downloadAttachment` when the server responds `410
 * ATTACHMENT_REMOVED` (api-spec.md §4.3) — the attachment was soft-removed
 * between the page load and the click. Distinct from the generic `Error`
 * every other failure raises so the caller can surface "this file was
 * removed" rather than a connection error (BR-33, AC-34).
 */
export class AttachmentRemovedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentRemovedError";
  }
}

/** The bytes of an attachment plus the filename to save them under. */
export interface AttachmentDownload {
  blob: Blob;
  /**
   * From the response's `Content-Disposition` header; `null` when the
   * header is absent or unparseable, in which case the caller falls back
   * to the attachment's `originalFilename`.
   */
  filename: string | null;
}

/**
 * `GET /api/attachments/:id/download` (api-spec.md §4.3): fetch the raw
 * bytes of an **active** attachment on an owned ticket, identified via the
 * session cookie (`credentials: "include"`) exactly like the calls above.
 * The bytes come back as a `Blob` together with the filename parsed from
 * `Content-Disposition`.
 *
 * A `410` raises `AttachmentRemovedError`; every other failure (`404`,
 * `5xx`, network error) raises a generic `Error`.
 */
export async function downloadAttachment(
  attachmentId: number,
): Promise<AttachmentDownload> {
  const response = await fetch(
    `${API_BASE_URL}/api/attachments/${attachmentId}/download`,
    { credentials: "include" },
  );

  if (!response.ok) {
    if (response.status === 410) {
      const body = await readErrorBody(response);
      throw new AttachmentRemovedError(
        extractSafeMessage(body) ??
          "This attachment has been removed and can no longer be downloaded.",
      );
    }
    throw new Error(
      `Failed to download attachment (status ${response.status})`,
    );
  }

  const blob = await response.blob();
  const filename = filenameFromContentDisposition(
    response.headers.get("Content-Disposition"),
  );
  return { blob, filename };
}

// ---------------------------------------------------------------------------
// Public Comments and "Problem Appears Resolved" (api-spec.md §3.1-3.3)
// ---------------------------------------------------------------------------

/** One entry in a comment thread (api-spec.md §3.1) — `author.role` is one of the three Lab 3 roles. */
export interface CommentEntry {
  id: number;
  body: string;
  createdAt: string;
  author: { id: number; name: string; role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR" };
}

/**
 * `GET /api/tickets/:id/comments` (api-spec.md §3.1): the owning Requester,
 * any IT Staff, or any Administrator, via the session cookie. Ordered
 * `createdAt` ascending, matching the server's own ordering.
 */
export async function fetchComments(ticketId: number): Promise<CommentEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/tickets/${ticketId}/comments`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to load comments (status ${response.status})`);
  }
  return response.json();
}

/**
 * Thrown by `postComment` for a `400 VALIDATION_FAILED` (empty,
 * whitespace-only, or over 2000 characters — BR-17, AC-22, AC-23).
 */
export class PostCommentValidationError extends Error {
  readonly fields: CreateTicketFieldError[];

  constructor(fields: CreateTicketFieldError[]) {
    super("Comment failed validation.");
    this.name = "PostCommentValidationError";
    this.fields = fields;
  }
}

/**
 * `POST /api/tickets/:id/comments` (api-spec.md §3.2): post one Public
 * Comment as the calling Requester or IT Staff member, via the session
 * cookie. `author`/`createdAt` come from the server (BR-16) regardless of
 * what this call sends — there is nothing to send but `body`.
 *
 * A `400 VALIDATION_FAILED` raises `PostCommentValidationError`; every
 * other failure (network error, `404`, `403`, `5xx`) raises a generic
 * `Error`.
 */
export async function postComment(ticketId: number, body: string): Promise<CommentEntry> {
  const response = await fetch(`${API_BASE_URL}/api/tickets/${ticketId}/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    if (response.status === 400) {
      const errorBody = await readErrorBody(response);
      if (
        typeof errorBody === "object" &&
        errorBody !== null &&
        (errorBody as Record<string, unknown>).error === "VALIDATION_FAILED" &&
        Array.isArray((errorBody as Record<string, unknown>).fields)
      ) {
        const fields = ((errorBody as Record<string, unknown>).fields as unknown[]).filter(isFieldError);
        throw new PostCommentValidationError(fields);
      }
    }
    throw new Error(`Failed to post comment (status ${response.status})`);
  }

  return response.json();
}

/**
 * ui-spec.md §7's frozen conflict-banner copy. The server's own `409
 * INVALID_STATE` message (api-spec.md §3.3) is a generic description, not
 * this exact UI string — `RequesterResolvedConflictError` always carries
 * this literal text regardless of what the response body says, so the
 * banner's wording can't drift if the server's message ever changes.
 */
export const REQUESTER_RESOLVED_CONFLICT_MESSAGE =
  "This ticket has been updated by IT Staff. Refresh to see its current state.";

/**
 * Thrown by `postRequesterResolved` for a `409 INVALID_STATE` (api-spec.md
 * §3.3) — IT Staff moved the ticket on (to Resolved, Closed or Cancelled)
 * since the page loaded. ui-spec.md §7's conflict banner is wired to this
 * error specifically.
 */
export class RequesterResolvedConflictError extends Error {
  constructor() {
    super(REQUESTER_RESOLVED_CONFLICT_MESSAGE);
    this.name = "RequesterResolvedConflictError";
  }
}

/**
 * `POST /api/tickets/:id/requester-resolved` (api-spec.md §3.3): the owning
 * Requester indicates the problem appears resolved. No request body. Does
 * not change the Ticket's status (BR-26) — the caller re-reads
 * `requesterResolvedAt` from a subsequent `fetchTicketDetail` to reflect
 * it, since this call itself returns no body.
 *
 * A `409 INVALID_STATE` raises `RequesterResolvedConflictError`; every
 * other failure (network error, `404`, `403`, `5xx`) raises a generic
 * `Error`.
 */
export async function postRequesterResolved(ticketId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/tickets/${ticketId}/requester-resolved`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    if (response.status === 409) {
      throw new RequesterResolvedConflictError();
    }
    throw new Error(`Failed to record the resolution indication (status ${response.status})`);
  }
}
