const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type Role = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

/** api-spec.md §2.1/§2.3 response shape — never carries a password or a hash. */
export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
}

/**
 * Best-effort parse of an error response body (api-spec.md §1.3). The body
 * may be absent, not JSON, or shaped unexpectedly — none of that should
 * throw; callers fall back to a generic message instead.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

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

export interface AuthFieldError {
  field: string;
  message: string;
}

function extractFieldErrors(body: unknown): AuthFieldError[] {
  if (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).error === "VALIDATION_FAILED" &&
    Array.isArray((body as Record<string, unknown>).fields)
  ) {
    return (body as Record<string, unknown>).fields as AuthFieldError[];
  }
  return [];
}

const GENERIC_LOGIN_FAILURE_MESSAGE =
  "We couldn't sign you in. Check your email and password and try again.";

/**
 * Thrown by `login` for a `401 INVALID_CREDENTIALS` or a `429 RATE_LIMITED`
 * (api-spec.md §2.1) — both use byte-identical wording server-side (BR-08,
 * BR-38), so the UI shows the same one callout either way (ui-spec.md §5)
 * and never leaks which case it was.
 */
export class LoginFailedError extends Error {
  constructor(message: string = GENERIC_LOGIN_FAILURE_MESSAGE) {
    super(message);
    this.name = "LoginFailedError";
  }
}

/** Thrown by `login` for a `400 VALIDATION_FAILED` (malformed/missing email or password). */
export class LoginValidationError extends Error {
  readonly fields: AuthFieldError[];

  constructor(fields: AuthFieldError[]) {
    super("Login request failed validation.");
    this.name = "LoginValidationError";
    this.fields = fields;
  }
}

/**
 * `POST /api/auth/login` (api-spec.md §2.1).
 *
 * `credentials: "include"` is required on every call in this module: the
 * session cookie is `HttpOnly` and this request is cross-origin from the
 * client dev server's own port, so the browser only sends/accepts it when
 * the request opts in explicitly — paired server-side with a credentialed,
 * specific-origin CORS config (server/src/app.ts) rather than the
 * wildcard `cors()` Lab 2 used, since a wildcard origin can never carry
 * `Access-Control-Allow-Credentials`.
 */
export async function login(email: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    if (response.status === 400) {
      throw new LoginValidationError(extractFieldErrors(await readErrorBody(response)));
    }
    if (response.status === 401 || response.status === 429) {
      const message = extractSafeMessage(await readErrorBody(response));
      throw new LoginFailedError(message);
    }
    throw new Error(`Failed to sign in (status ${response.status})`);
  }

  return response.json();
}

/**
 * `POST /api/auth/logout` (api-spec.md §2.2). Deliberately does not throw
 * on a non-2xx response (e.g. a session that was already invalid) — the
 * caller's job (clearing client-held user state and redirecting to
 * `/login`) is correct either way, and logout must never get "stuck"
 * client-side because the server-side half had nothing left to invalidate.
 */
export async function logout(): Promise<void> {
  await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  }).catch(() => {
    // Network failure: still nothing more the client can do — the caller
    // clears local state and navigates to /login regardless.
  });
}

/**
 * `GET /api/auth/me` (api-spec.md §2.3): the caller's own identity, role
 * and password-change state, re-read from the server on every call.
 * Throws on any non-2xx response (401 included) — every caller treats that
 * uniformly as "not authenticated".
 */
export async function fetchCurrentUser(): Promise<AuthUser> {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Not authenticated (status ${response.status})`);
  }
  return response.json();
}

/** Voluntary path (api-spec.md §2.4): `mustChangePassword` is currently false. */
export interface ChangePasswordVoluntaryInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** Forced path (api-spec.md §2.4): `mustChangePassword` is currently true — `currentPassword` is neither required nor accepted (BR-42). */
export interface ChangePasswordForcedInput {
  newPassword: string;
  confirmPassword: string;
}

/** Thrown by `changePassword` for a `400 VALIDATION_FAILED` (length, mismatch, same-as-current). */
export class ChangePasswordValidationError extends Error {
  readonly fields: AuthFieldError[];

  constructor(fields: AuthFieldError[]) {
    super("Password change failed validation.");
    this.name = "ChangePasswordValidationError";
    this.fields = fields;
  }
}

/** Thrown by `changePassword` for a `403 WRONG_PASSWORD` (voluntary path, wrong `currentPassword`). */
export class WrongPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrongPasswordError";
  }
}

/** `POST /api/auth/change-password` (api-spec.md §2.4). */
export async function changePassword(
  input: ChangePasswordVoluntaryInput | ChangePasswordForcedInput,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    if (response.status === 400) {
      throw new ChangePasswordValidationError(extractFieldErrors(await readErrorBody(response)));
    }
    if (response.status === 403) {
      const message = extractSafeMessage(await readErrorBody(response)) ?? "Current password is incorrect.";
      throw new WrongPasswordError(message);
    }
    throw new Error(`Failed to change password (status ${response.status})`);
  }
}
