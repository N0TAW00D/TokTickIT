import type { RequestedPriority } from "../tickets/api";
import type { Role } from "../auth/api";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/** All eight `TicketStatus` values (server/src/validation/staffTicketQueueQuery.ts `STAFF_QUEUE_STATUSES`). */
export type StaffQueueStatus =
  | "NEW"
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_FOR_REQUESTER"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED"
  | "CANCELLED";

/** IT Priority values — same three as Requested Priority (ticketFields.ts `PRIORITIES`). */
export type ItPriority = RequestedPriority;

/** The four server-sortable fields (server/src/validation/staffTicketQueueQuery.ts `STAFF_SORT_FIELDS`). */
export type StaffSortField = "createdAt" | "updatedAt" | "itPriority" | "ticketNumber";

export type StaffSortDirection = "asc" | "desc";

/**
 * The `owner` query param's three shapes (server/src/validation/staffTicketQueueQuery.ts
 * `OwnerFilter`): the literal strings "unassigned"/"me", or a specific
 * user's numeric id.
 */
export type OwnerFilterValue = "unassigned" | "me" | number;

/** One row of `GET /api/staff/tickets` (server/src/routes/staff.ts). */
export interface StaffTicketQueueItem {
  id: number;
  ticketNumber: string;
  summary: string;
  category: { id: number; name: string };
  requestedPriority: RequestedPriority;
  itPriority: ItPriority;
  status: StaffQueueStatus;
  /** `null` when unassigned (ui-spec.md §3.4: rendered via `OwnerCell`). */
  owner: { id: number; name: string } | null;
  requesterResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /api/staff/tickets` response shape (server/src/routes/staff.ts) —
 * pagination fields sit flat on the body, unlike `fetchMyTickets`'s nested
 * `meta` (api-spec.md §3.2 vs. §4.1: two different response shapes, kept
 * exactly as each endpoint actually returns them rather than normalized to
 * one client-side convention).
 */
export interface StaffTicketQueueResponse {
  items: StaffTicketQueueItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Query params for `GET /api/staff/tickets` (server/src/validation/staffTicketQueueQuery.ts).
 * All optional — an absent field is simply not sent, and the server
 * applies its own documented default (`sort=itPriority`,
 * `direction=desc`, `page=1`, `pageSize=20`).
 */
export interface FetchStaffTicketsParams {
  search?: string;
  status?: StaffQueueStatus;
  itPriority?: ItPriority;
  categoryId?: number;
  owner?: OwnerFilterValue;
  sort?: StaffSortField;
  direction?: StaffSortDirection;
  page?: number;
  pageSize?: number;
}

/**
 * One row of `GET /api/staff/assignable-users` (server/src/routes/staff.ts,
 * api-spec.md §4.2): the active IT Staff and Administrator users BR-19
 * allows as a Ticket Owner. `role` reuses `Role` (auth/api.ts) narrowed to
 * the two values this endpoint ever returns — a Requester is never included.
 */
export interface AssignableUser {
  id: number;
  name: string;
  role: Extract<Role, "IT_STAFF" | "ADMINISTRATOR">;
}

/** One `{ field, message }` entry from a `400 INVALID_QUERY` body (server/src/routes/staff.ts). */
export interface StaffQueueFieldError {
  field: string;
  message: string;
}

/**
 * Best-effort parse of an error response body. The body may be absent, not
 * JSON, or shaped unexpectedly — none of that should throw; callers fall
 * back to the generic failure path instead.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isFieldError(value: unknown): value is StaffQueueFieldError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).field === "string" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

/**
 * Thrown by `fetchStaffTickets` on a `400 INVALID_QUERY` (server/src/routes/staff.ts)
 * — shouldn't happen from params this client itself builds, but is
 * distinguished from a generic failure in case a future control ever
 * constructs an out-of-range value (e.g. `pageSize`).
 */
export class StaffQueueInvalidQueryError extends Error {
  readonly fields: StaffQueueFieldError[];

  constructor(fields: StaffQueueFieldError[]) {
    super("The ticket queue request failed validation.");
    this.name = "StaffQueueInvalidQueryError";
    this.fields = fields;
  }
}

/**
 * `GET /api/staff/tickets` (server/src/routes/staff.ts, api-spec.md §4.1):
 * the shared IT Staff queue across all Requesters, identified via the
 * session cookie (`credentials: "include"`) exactly like `fetchMyTickets`.
 * Restricted server-side to the `IT_STAFF` role — an Administrator or
 * Requester caller gets a `403` before any lookup, which surfaces here as
 * the generic `Error` path (the client-side `RequireRole` guard is what
 * actually prevents this screen from ever being reached by the wrong
 * role, so a `403` reaching this function would only mean a stale session
 * or a direct API call).
 *
 * A blank/whitespace-only `search` is dropped rather than sent, matching
 * `fetchMyTickets`'s convention for the sibling Requester ticket list.
 * `owner` is sent as-is: the literal string "unassigned"/"me", or a
 * numeric id stringified.
 *
 * A `400 INVALID_QUERY` raises `StaffQueueInvalidQueryError` with its
 * `fields[]` preserved; every other failure (network error, `403`, `5xx`)
 * raises a generic `Error`.
 */
export async function fetchStaffTickets(
  params: FetchStaffTicketsParams = {},
): Promise<StaffTicketQueueResponse> {
  const query = new URLSearchParams();
  const trimmedSearch = params.search?.trim();
  if (trimmedSearch) query.set("search", trimmedSearch);
  if (params.status !== undefined) query.set("status", params.status);
  if (params.itPriority !== undefined) query.set("itPriority", params.itPriority);
  if (params.categoryId !== undefined) {
    query.set("categoryId", String(params.categoryId));
  }
  if (params.owner !== undefined) query.set("owner", String(params.owner));
  if (params.sort !== undefined) query.set("sort", params.sort);
  if (params.direction !== undefined) query.set("direction", params.direction);
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.pageSize !== undefined) {
    query.set("pageSize", String(params.pageSize));
  }

  const queryString = query.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/staff/tickets${queryString ? `?${queryString}` : ""}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    if (response.status === 400) {
      const body = await readErrorBody(response);
      if (
        typeof body === "object" &&
        body !== null &&
        (body as Record<string, unknown>).error === "INVALID_QUERY" &&
        Array.isArray((body as Record<string, unknown>).fields)
      ) {
        const fields = ((body as Record<string, unknown>).fields as unknown[]).filter(
          isFieldError,
        );
        throw new StaffQueueInvalidQueryError(fields);
      }
    }
    throw new Error(`Failed to load the ticket queue (status ${response.status})`);
  }

  return response.json();
}

/**
 * `GET /api/staff/assignable-users` (server/src/routes/staff.ts, api-spec.md
 * §4.2): active IT Staff and Administrator users, ordered by name ascending
 * — the full pool BR-19 allows as a Ticket Owner. IT Staff only; a
 * Requester or Administrator caller gets a `403` (Administrator has
 * `GET /api/users`, §6.1, instead), which surfaces here as the generic
 * `Error` path exactly like `fetchStaffTickets`'s own 403 handling — the
 * `RequireRole` guard is what actually keeps the wrong role off this
 * screen.
 *
 * The queue's Owner filter (ui-spec.md §9: "plus each active IT Staff")
 * further narrows this response to `role === "IT_STAFF"` client-side — the
 * `ADMINISTRATOR` entries this endpoint also returns exist for a later
 * Ticket Owner select (§10) that needs both roles, not for this screen.
 */
export async function fetchAssignableUsers(): Promise<AssignableUser[]> {
  const response = await fetch(`${API_BASE_URL}/api/staff/assignable-users`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to load assignable users (status ${response.status})`);
  }

  return response.json();
}
