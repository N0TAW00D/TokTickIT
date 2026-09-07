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
  attachments: unknown[];
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
 * tickets, identified via the `X-Requester-Id` header (§1.2) exactly like
 * `createTicket` below — never scoped by anything sent in the query.
 *
 * A blank/whitespace-only `search` is dropped rather than sent, matching
 * the server's own "blank search ⇒ ignored" rule (BR-16) so an empty
 * string can't accidentally override the server default differently from
 * omitting the param entirely.
 */
export async function fetchMyTickets(
  requesterId: number,
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
    { headers: { "X-Requester-Id": String(requesterId) } },
  );
  if (!response.ok) {
    throw new Error(`Failed to load tickets (status ${response.status})`);
  }
  return response.json();
}

/**
 * `GET /api/tickets/:id` (api-spec.md §3.3) response: same shape as the
 * `POST /api/tickets` `201` body, plus a populated `attachments` array. The
 * Requester Ticket Detail screen (ui-spec.md §10) ignores `attachments` —
 * that section belongs to a later slice.
 */
export type TicketDetailResponse = CreateTicketResponse;

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
 * calling Requester, identified via the `X-Requester-Id` header (§1.2)
 * exactly like `createTicket`/`fetchMyTickets`.
 *
 * A `404` raises `TicketNotFoundError`; every other failure (network error,
 * 400, 500) raises a generic `Error`.
 */
export async function fetchTicketDetail(
  requesterId: number,
  ticketId: number,
): Promise<TicketDetailResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickets/${ticketId}`, {
    headers: {
      "X-Requester-Id": String(requesterId),
    },
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
 * Requester, identified via the `X-Requester-Id` header (§1.2) rather than
 * the request body.
 *
 * A `400 VALIDATION_FAILED` response raises `CreateTicketValidationError`
 * with its `fields[]` preserved; every other failure (network error, 5xx,
 * or a `400` of a different `error` code) raises a generic `Error`.
 */
export async function createTicket(
  requesterId: number,
  payload: CreateTicketRequest,
): Promise<CreateTicketResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requester-Id": String(requesterId),
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

/** One uploaded attachment, per the `POST /api/tickets/:id/attachments` `201` body (api-spec.md §4.1). */
export interface AttachmentResponse {
  id: number;
  ticketId: number;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  isRemoved: boolean;
  removedAt: string | null;
  removedReason: string | null;
  createdAt: string;
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
 * Best-effort read of the error body's safe `message` (api-spec.md §1.3).
 * Falls back to a generic status-coded message when the body is absent,
 * not JSON, or missing the field — never throws.
 */
function readErrorMessage(body: unknown, status: number): string {
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).message === "string"
  ) {
    return (body as Record<string, unknown>).message as string;
  }
  return `Failed to upload attachment (status ${status}).`;
}

/**
 * `POST /api/tickets/:id/attachments` (api-spec.md §4.1): upload one file
 * to a ticket owned by the calling Requester, identified via the
 * `X-Requester-Id` header (§1.2) exactly like `createTicket` above.
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
  requesterId: number,
  ticketId: number,
  file: File,
): Promise<AttachmentResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE_URL}/api/tickets/${ticketId}/attachments`,
    {
      method: "POST",
      headers: { "X-Requester-Id": String(requesterId) },
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
