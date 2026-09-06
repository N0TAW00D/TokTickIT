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
