import type { Role } from "../auth/api";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/**
 * The user shape returned by every route in this module (api-spec.md §6.1's
 * `GET /api/users` list item, and the identical body `POST /api/users`
 * (§6.2) and `PATCH /api/users/:id` (§6.3) return) — confirmed against
 * `server/src/routes/users.ts`'s `adminUserJson`/`ADMIN_USER_SELECT`. Never
 * carries `passwordHash` (BR-06, AC-13).
 */
export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
}

/** One `{ field, message }` entry from a `VALIDATION_FAILED` body (api-spec.md §1.3). */
export interface UserFieldError {
  field: string;
  message: string;
}

/**
 * Best-effort parse of an error response body. The body may be absent, not
 * JSON, or shaped unexpectedly — none of that should throw; callers fall
 * back to the generic failure path instead. Same idiom as
 * `client/src/tickets/api.ts` and `client/src/staff/api.ts`.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isFieldError(value: unknown): value is UserFieldError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).field === "string" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

/**
 * `body.fields` when `body` is a `VALIDATION_FAILED` error (api-spec.md
 * §1.3); `null` otherwise, including when the body is absent or malformed.
 * Shared by every route in this module that can 400 with field errors
 * (`createUser`, `updateUser`, `setUserInitialPassword`), so the three
 * `409`/`400` guard-rail errors below are constructed the same way
 * regardless of which call raised them.
 */
function extractValidationFields(body: unknown): UserFieldError[] | null {
  if (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).error === "VALIDATION_FAILED" &&
    Array.isArray((body as Record<string, unknown>).fields)
  ) {
    return ((body as Record<string, unknown>).fields as unknown[]).filter(isFieldError);
  }
  return null;
}

/** The error response's `error` code (api-spec.md §1.3), or `undefined` when absent/malformed. */
function extractErrorCode(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).error === "string"
  ) {
    return (body as Record<string, unknown>).error as string;
  }
  return undefined;
}

/**
 * Thrown by `createUser` and `updateUser` for a `409 EMAIL_IN_USE`
 * (api-spec.md §6.2, §6.3; BR-09, BR-29) — one shared class for both call
 * sites, since the dialog handles it identically either way: put the
 * message on the Email field (ui-spec.md §11: "Field-level on Email").
 * Carries ui-spec.md §11's exact frozen copy, not the server's own
 * (slightly different) `message` text, matching the
 * `STATUS_TRANSITION_CONFLICT_MESSAGE` precedent in
 * `client/src/tickets/api.ts` of preferring the UI spec's literal wording
 * over whatever the response body happens to say.
 */
export const EMAIL_IN_USE_MESSAGE = "That email address is already in use.";

export class EmailInUseError extends Error {
  constructor(message: string = EMAIL_IN_USE_MESSAGE) {
    super(message);
    this.name = "EmailInUseError";
  }
}

/**
 * Thrown by `updateUser` for a `409 SELF_DEACTIVATION` (api-spec.md §6.3;
 * BR-31, AC-53) — the caller is `:id` and tried to set `isActive: false`.
 * Carries ui-spec.md §11's exact guard-rail copy.
 */
export const SELF_DEACTIVATION_MESSAGE = "You can't deactivate your own account.";

export class SelfDeactivationError extends Error {
  constructor(message: string = SELF_DEACTIVATION_MESSAGE) {
    super(message);
    this.name = "SelfDeactivationError";
  }
}

/**
 * Thrown by `updateUser` for a `409 LAST_ADMIN` (api-spec.md §6.3; BR-32,
 * AC-54) — the change would leave zero active Administrators. Carries
 * ui-spec.md §11's exact guard-rail copy.
 */
export const LAST_ADMIN_MESSAGE =
  "This is the last active administrator. Promote another administrator first.";

export class LastAdminError extends Error {
  constructor(message: string = LAST_ADMIN_MESSAGE) {
    super(message);
    this.name = "LastAdminError";
  }
}

/**
 * Thrown by `createUser`, `updateUser` and `setUserInitialPassword` for a
 * `400 VALIDATION_FAILED` (api-spec.md §6.2, §6.3, §6.4) — carries the
 * `fields[]` the server rejected so the caller can show per-field messages,
 * same idiom as `CreateTicketValidationError` in `client/src/tickets/api.ts`.
 * One shared class across all three routes, since every dialog that can
 * trigger this handles it the same way: render each field's message next to
 * its input.
 */
export class UserValidationError extends Error {
  readonly fields: UserFieldError[];

  constructor(fields: UserFieldError[]) {
    super("One or more fields are invalid.");
    this.name = "UserValidationError";
    this.fields = fields;
  }
}

/** Query params for `GET /api/users` (api-spec.md §6.1). Both optional. */
export interface FetchUsersParams {
  search?: string;
  role?: Role;
}

/**
 * `GET /api/users` (api-spec.md §6.1): every user, Administrator-only, via
 * the session cookie (`credentials: "include"`) exactly like
 * `fetchStaffTickets`. A Requester or IT Staff caller gets a `403` before
 * any lookup, which surfaces here as the generic `Error` path — the
 * client-side `RequireRole` guard is what actually keeps the wrong role off
 * this screen.
 *
 * A blank/whitespace-only `search` is dropped rather than sent, matching
 * `fetchStaffTickets`'s convention. A `400 INVALID_QUERY` should not
 * practically happen from params this client itself builds (`role` is
 * always one of the three enum values here), so — like
 * `patchTicketItPriority`'s own "client bug" `400` case — it is not given a
 * dedicated error class and simply raises a generic `Error`, same as every
 * other non-ok response.
 */
export async function fetchUsers(params: FetchUsersParams = {}): Promise<AdminUser[]> {
  const query = new URLSearchParams();
  const trimmedSearch = params.search?.trim();
  if (trimmedSearch) query.set("search", trimmedSearch);
  if (params.role !== undefined) query.set("role", params.role);

  const queryString = query.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/users${queryString ? `?${queryString}` : ""}`,
    { credentials: "include" },
  );

  if (!response.ok) {
    throw new Error(`Failed to load users (status ${response.status})`);
  }

  return response.json();
}

/** `POST /api/users` request body (api-spec.md §6.2). */
export interface CreateUserPayload {
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  initialPassword: string;
}

/**
 * `POST /api/users` (api-spec.md §6.2): create a new user as the calling
 * Administrator, via the session cookie (`credentials: "include"`).
 * `mustChangePassword` is always `true` on the returned user — set by the
 * server, never client-settable (BR-30, AC-48).
 *
 * A `409 EMAIL_IN_USE` raises `EmailInUseError`; a `400 VALIDATION_FAILED`
 * raises `UserValidationError` with its `fields[]` preserved; every other
 * failure (network error, `403`, `5xx`) raises a generic `Error`.
 */
export async function createUser(payload: CreateUserPayload): Promise<AdminUser> {
  const response = await fetch(`${API_BASE_URL}/api/users`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    if (response.status === 409) {
      throw new EmailInUseError();
    }
    if (response.status === 400) {
      const fields = extractValidationFields(await readErrorBody(response));
      if (fields) {
        throw new UserValidationError(fields);
      }
    }
    throw new Error(`Failed to create user (status ${response.status})`);
  }

  return response.json();
}

/**
 * `PATCH /api/users/:id` request body (api-spec.md §6.3): any subset of
 * these four fields, and nothing else (BR-28).
 */
export type UpdateUserPayload = Partial<{
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
}>;

/**
 * `PATCH /api/users/:id` (api-spec.md §6.3): update a user as the calling
 * Administrator, via the session cookie (`credentials: "include"`).
 *
 * - `409 EMAIL_IN_USE` raises `EmailInUseError` (same class as `createUser`).
 * - `409 SELF_DEACTIVATION` raises `SelfDeactivationError` — the caller
 *   tried to deactivate their own account (BR-31, AC-53).
 * - `409 LAST_ADMIN` raises `LastAdminError` — the change would leave zero
 *   active Administrators (BR-32, AC-54).
 * - `400 VALIDATION_FAILED` raises `UserValidationError` with its `fields[]`
 *   preserved.
 * - `404` (unreachable in practice from a UI that only edits rows it just
 *   listed) and every other failure (network error, `403`, `5xx`) raise a
 *   generic `Error`.
 */
export async function updateUser(
  id: number,
  payload: UpdateUserPayload,
): Promise<AdminUser> {
  const response = await fetch(`${API_BASE_URL}/api/users/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    if (response.status === 409) {
      const code = extractErrorCode(await readErrorBody(response));
      if (code === "SELF_DEACTIVATION") throw new SelfDeactivationError();
      if (code === "LAST_ADMIN") throw new LastAdminError();
      if (code === "EMAIL_IN_USE") throw new EmailInUseError();
    } else if (response.status === 400) {
      const fields = extractValidationFields(await readErrorBody(response));
      if (fields) {
        throw new UserValidationError(fields);
      }
    }
    throw new Error(`Failed to update user (status ${response.status})`);
  }

  return response.json();
}

/**
 * `POST /api/users/:id/initial-password` (api-spec.md §6.4): reset a user's
 * password as the calling Administrator, via the session cookie
 * (`credentials: "include"`). On success the server responds `204` with no
 * body (`mustChangePassword` is set to `true` and every session for that
 * user is deleted server-side, BR-30, BR-41) — this function resolves with
 * `void` and never calls `response.json()` on the success path.
 *
 * A `400 VALIDATION_FAILED` (password outside 8-128 characters) raises
 * `UserValidationError` with its `fields[]` preserved; `404` (unreachable in
 * practice, same reasoning as `updateUser`) and every other failure
 * (network error, `403`, `5xx`) raise a generic `Error`.
 */
export async function setUserInitialPassword(
  id: number,
  initialPassword: string,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/users/${id}/initial-password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initialPassword }),
  });

  if (!response.ok) {
    if (response.status === 400) {
      const fields = extractValidationFields(await readErrorBody(response));
      if (fields) {
        throw new UserValidationError(fields);
      }
    }
    throw new Error(`Failed to set the initial password (status ${response.status})`);
  }
}
