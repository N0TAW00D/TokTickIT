// Query-param parser for GET /api/users (api-spec.md §6.1;
// specification.md FR-28, FR-35; AC-45, AC-46, AC-47, AC-55).
//
// Mirrors `staffTicketQueueQuery.ts`'s shape: a pure, synchronous,
// Express/DB-free function that only judges the *shape* of each query
// param. Per §6.1 there is no pagination, no sort param and no second
// simultaneous filter beyond `search` + `role` together — both may be
// applied at once, so this parser only ever rejects `role` when it isn't
// one of the three permitted enum values; every rejected param is
// collected (not just the first) for the `400 INVALID_QUERY` body's
// `fields[]`, matching `invalidQuery`'s convention in `staff.ts`.

import type { FieldError } from './ticketFields.ts';

export const ADMIN_USER_ROLES = ['REQUESTER', 'IT_STAFF', 'ADMINISTRATOR'] as const;
export type AdminUserRole = (typeof ADMIN_USER_ROLES)[number];

export interface AdminUsersQuery {
  search?: string;
  role?: AdminUserRole;
}

export type AdminUsersQueryResult = { ok: true; value: AdminUsersQuery } | { ok: false; errors: FieldError[] };

/**
 * Collapses one query-string value to a single trimmed string. Returns
 * `undefined` when the param key was absent entirely. Returns `null` when
 * the raw value isn't a single plain string (e.g. a repeated `?role=a&role=b`
 * or a bracketed `?search[x]=a`) — callers treat `null` as a shape failure,
 * same reasoning as `staffTicketQueueQuery.ts`'s identical helper.
 */
function singleTrimmedValue(raw: unknown): string | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  return raw.trim();
}

type ParamResult<T> = { ok: true; value: T | undefined } | { ok: false; error: FieldError };

function parseSearch(raw: unknown): ParamResult<string> {
  const value = singleTrimmedValue(raw);
  if (value === null) {
    return { ok: false, error: { field: 'search', message: 'search must be a single string value.' } };
  }
  // Blank/whitespace-only search (absent, or `?search=`/`?search=%20`) is
  // "no search", not an error — matches `staffTicketQueueQuery.ts`'s
  // `parseSearch` convention for the sibling staff-queue endpoint.
  if (value === '') return { ok: true, value: undefined };
  return { ok: true, value };
}

function parseRole(raw: unknown): ParamResult<AdminUserRole> {
  const value = singleTrimmedValue(raw);
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || !(ADMIN_USER_ROLES as readonly string[]).includes(value)) {
    return { ok: false, error: { field: 'role', message: 'role must be one of REQUESTER, IT_STAFF, ADMINISTRATOR.' } };
  }
  return { ok: true, value: value as AdminUserRole };
}

/**
 * Parses and shape-validates every `GET /api/users` query param
 * (api-spec.md §6.1). On failure, `errors` lists one entry per rejected
 * param (only `role` can currently fail).
 */
export function parseAdminUsersQuery(query: Record<string, unknown>): AdminUsersQueryResult {
  const searchResult = parseSearch(query.search);
  const roleResult = parseRole(query.role);

  const errors: FieldError[] = [];
  if (!searchResult.ok) errors.push(searchResult.error);
  if (!roleResult.ok) errors.push(roleResult.error);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const search = (searchResult as Extract<typeof searchResult, { ok: true }>).value;
  const role = (roleResult as Extract<typeof roleResult, { ok: true }>).value;

  return { ok: true, value: { search, role } };
}
