// Query-param parser for GET /api/staff/tickets (api-spec.md §4.1;
// specification.md FR-19, BR-35, AC-26..AC-31, AC-33).
//
// Mirrors `ticketListQuery.ts`'s shape: a pure, synchronous function that
// only judges the *shape* of each query param against §4.1's rule table.
// It deliberately does not check whether `categoryId` or an integer
// `owner` names a real row — a value that matches no row simply produces
// `items: []` (§4.1: "a no-results state, not an error"), exactly like
// `owner=me`/`owner=unassigned` for a queue with no such tickets. The one
// exception, kept for parity with `ticketListQuery.ts`'s `categoryId`
// bound, is a syntactically valid integer far outside Postgres `int4`
// range: that can never reference any row and would otherwise reach the
// database as a driver-level range error (a `500`), so it is rejected here
// as a shape failure instead.
//
// Every rejected param is collected (not just the first) for the
// `400 INVALID_QUERY` body's `fields[]` (§4.1, BR-35, AC-31).

import type { FieldError } from './ticketFields.ts';
import { PRIORITIES, type Priority } from './ticketFields.ts';

export const STAFF_SORT_FIELDS = ['createdAt', 'updatedAt', 'itPriority', 'ticketNumber'] as const;
export type StaffSortField = (typeof STAFF_SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

// The eight `TicketStatus` enum values (schema.prisma). Kept as an
// explicit list, not a re-export of the generated Prisma enum, so this
// file's own `as const` narrowing works the same way every other filter
// enum below does.
export const STAFF_QUEUE_STATUSES = [
  'NEW',
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_REQUESTER',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'CANCELLED',
] as const;
export type StaffQueueStatus = (typeof STAFF_QUEUE_STATUSES)[number];

const DEFAULT_SORT: StaffSortField = 'itPriority';
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

/** Largest value Postgres `int4` can hold — mirrors `ticketListQuery.ts`'s own constant. */
const PG_INT4_MAX = 2_147_483_647;

export type OwnerFilter = { kind: 'unassigned' } | { kind: 'me' } | { kind: 'id'; id: number };

export interface StaffTicketQueueQuery {
  search?: string;
  status?: StaffQueueStatus;
  itPriority?: Priority;
  categoryId?: number;
  owner?: OwnerFilter;
  sort: StaffSortField;
  direction: SortDirection;
  page: number;
  pageSize: number;
}

export type StaffTicketQueueQueryResult =
  | { ok: true; value: StaffTicketQueueQuery }
  | { ok: false; errors: FieldError[] };

/**
 * Collapses one query-string value to a single trimmed string. Returns
 * `undefined` when the param key was absent entirely (§4.1: absent =>
 * default). Returns `null` when the raw value isn't a single plain string
 * (e.g. a repeated `?sort=a&sort=b` or a bracketed `?owner[x]=a`) — callers
 * treat `null` as a shape failure, same reasoning as
 * `ticketListQuery.ts`'s identical helper.
 */
function singleTrimmedValue(raw: unknown): string | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  return raw.trim();
}

type ParamResult<T> = { ok: true; value: T | undefined } | { ok: false; error: FieldError };

function parseEnumParam<T extends string>(field: string, raw: unknown, allowed: readonly T[], message: string): ParamResult<T> {
  const value = singleTrimmedValue(raw);
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || !(allowed as readonly string[]).includes(value)) {
    return { ok: false, error: { field, message } };
  }
  return { ok: true, value: value as T };
}

function parseSearch(raw: unknown): ParamResult<string> {
  const value = singleTrimmedValue(raw);
  if (value === null) {
    return { ok: false, error: { field: 'search', message: 'search must be a single string value.' } };
  }
  // Blank/whitespace-only search (absent, or `?search=`/`?search=%20`) is
  // treated as "no search", not an error — §4.1 does not list a blank
  // `search` among the `INVALID_QUERY` cases, and this matches the
  // `search` convention `ticketListQuery.ts` already uses for the sibling
  // Requester ticket list.
  if (value === '') return { ok: true, value: undefined };
  return { ok: true, value };
}

/**
 * `categoryId`: §4.1 lists "non-integer categoryId" as the only 400 case —
 * unlike `ticketListQuery.ts`'s `parseCategoryId`, this endpoint does not
 * additionally verify the category exists/is active (a filter that names
 * no real category is just a query that matches nothing: `items: []`).
 * The int4-range bound below exists only to avoid handing the database a
 * value that could never be a real id and would raise a driver-level
 * range error instead of a clean "no match".
 */
function parseCategoryId(raw: unknown): ParamResult<number> {
  const value = singleTrimmedValue(raw);
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || !/^\d+$/.test(value)) {
    return { ok: false, error: { field: 'categoryId', message: 'categoryId must be an integer.' } };
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num > PG_INT4_MAX) {
    return { ok: false, error: { field: 'categoryId', message: 'categoryId must be an integer.' } };
  }
  return { ok: true, value: num };
}

/**
 * `owner`: `unassigned` | `me` | an integer user id (§4.1). Resolving `me`
 * to the caller's own id is left to the route, which is the only place
 * that has `req.authUser` — this parser only judges shape, exactly like
 * `categoryId` above.
 */
function parseOwner(raw: unknown): ParamResult<OwnerFilter> {
  const value = singleTrimmedValue(raw);
  if (value === undefined) return { ok: true, value: undefined };
  const invalid = {
    ok: false as const,
    error: { field: 'owner', message: 'owner must be "unassigned", "me", or a user id.' },
  };
  if (value === null) return invalid;
  if (value === 'unassigned') return { ok: true, value: { kind: 'unassigned' } };
  if (value === 'me') return { ok: true, value: { kind: 'me' } };
  if (!/^\d+$/.test(value)) return invalid;
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < 1 || num > PG_INT4_MAX) return invalid;
  return { ok: true, value: { kind: 'id', id: num } };
}

function parsePage(raw: unknown): ParamResult<number> {
  const value = singleTrimmedValue(raw);
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || !/^\d+$/.test(value)) {
    return { ok: false, error: { field: 'page', message: 'page must be an integer >= 1.' } };
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < 1 || num > PG_INT4_MAX) {
    return { ok: false, error: { field: 'page', message: 'page must be an integer >= 1.' } };
  }
  return { ok: true, value: num };
}

function parsePageSize(raw: unknown): ParamResult<number> {
  const value = singleTrimmedValue(raw);
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || !/^\d+$/.test(value)) {
    return { ok: false, error: { field: 'pageSize', message: 'pageSize must be an integer between 1 and 100.' } };
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < MIN_PAGE_SIZE || num > MAX_PAGE_SIZE) {
    return { ok: false, error: { field: 'pageSize', message: 'pageSize must be an integer between 1 and 100.' } };
  }
  return { ok: true, value: num };
}

/**
 * Parses and shape-validates every `GET /api/staff/tickets` query param
 * (api-spec.md §4.1). On success, `sort`/`direction`/`page`/`pageSize` are
 * always their parsed value or documented default — never `undefined`.
 * `direction`'s default depends on the *resolved* `sort` (default or
 * explicit): `desc` when sorting by `itPriority`, `asc` otherwise (§4.1).
 * On failure, `errors` lists one entry per rejected param.
 */
export function parseStaffTicketQueueQuery(query: Record<string, unknown>): StaffTicketQueueQueryResult {
  const searchResult = parseSearch(query.search);
  const statusResult = parseEnumParam(
    'status',
    query.status,
    STAFF_QUEUE_STATUSES,
    'status must be one of NEW, OPEN, IN_PROGRESS, WAITING_FOR_REQUESTER, RESOLVED, CLOSED, REOPENED, CANCELLED.',
  );
  const itPriorityResult = parseEnumParam('itPriority', query.itPriority, PRIORITIES, 'itPriority must be one of LOW, MEDIUM, HIGH.');
  const categoryIdResult = parseCategoryId(query.categoryId);
  const ownerResult = parseOwner(query.owner);
  const sortResult = parseEnumParam(
    'sort',
    query.sort,
    STAFF_SORT_FIELDS,
    'sort must be one of createdAt, updatedAt, itPriority, ticketNumber.',
  );
  const directionResult = parseEnumParam('direction', query.direction, SORT_DIRECTIONS, 'direction must be one of asc, desc.');
  const pageResult = parsePage(query.page);
  const pageSizeResult = parsePageSize(query.pageSize);

  const errors: FieldError[] = [];
  if (!searchResult.ok) errors.push(searchResult.error);
  if (!statusResult.ok) errors.push(statusResult.error);
  if (!itPriorityResult.ok) errors.push(itPriorityResult.error);
  if (!categoryIdResult.ok) errors.push(categoryIdResult.error);
  if (!ownerResult.ok) errors.push(ownerResult.error);
  if (!sortResult.ok) errors.push(sortResult.error);
  if (!directionResult.ok) errors.push(directionResult.error);
  if (!pageResult.ok) errors.push(pageResult.error);
  if (!pageSizeResult.ok) errors.push(pageSizeResult.error);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Every *Result is `ok: true` at this point (errors is empty).
  const search = (searchResult as Extract<typeof searchResult, { ok: true }>).value;
  const status = (statusResult as Extract<typeof statusResult, { ok: true }>).value;
  const itPriority = (itPriorityResult as Extract<typeof itPriorityResult, { ok: true }>).value;
  const categoryId = (categoryIdResult as Extract<typeof categoryIdResult, { ok: true }>).value;
  const owner = (ownerResult as Extract<typeof ownerResult, { ok: true }>).value;
  const sort = (sortResult as Extract<typeof sortResult, { ok: true }>).value ?? DEFAULT_SORT;
  const explicitDirection = (directionResult as Extract<typeof directionResult, { ok: true }>).value;
  const direction = explicitDirection ?? (sort === 'itPriority' ? 'desc' : 'asc');
  const page = (pageResult as Extract<typeof pageResult, { ok: true }>).value ?? DEFAULT_PAGE;
  const pageSize = (pageSizeResult as Extract<typeof pageSizeResult, { ok: true }>).value ?? DEFAULT_PAGE_SIZE;

  return {
    ok: true,
    value: { search, status, itPriority, categoryId, owner, sort, direction, page, pageSize },
  };
}
