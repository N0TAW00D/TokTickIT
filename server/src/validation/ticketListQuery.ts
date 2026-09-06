// Query-param parser for GET /api/tickets (api-spec.md §3.2; specification.md
// BR-16..BR-19, FR-24..FR-31, UNIT-05).
//
// This is a pure, synchronous function: it only judges the *shape* of each
// query param against §3.2's rule table. It deliberately cannot check
// whether `categoryId` names a real, active Category — that requires a
// database round trip, which the route (`../routes/tickets.ts`) performs
// itself after this parser succeeds, exactly like `createTicket.ts` checks
// `categoryId`/`relatedSystemId` existence only after `ticketFields.ts`'s
// synchronous shape validation passes on `POST /api/tickets`.
//
// Every rejected param is collected (not just the first), matching how
// `validateTicketFields` collects every rejected body field for
// `VALIDATION_FAILED` — here for `INVALID_QUERY`'s `fields[]` (BR-19,
// FR-29, AC-28).

import type { FieldError } from './ticketFields.ts';
import { PRIORITIES, type Priority } from './ticketFields.ts';

export const SORT_FIELDS = ['createdAt', 'updatedAt', 'ticketNumber'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

// "NEW" is the only TicketStatus value in Lab 2 (schema.prisma), but the
// filter is still validated as an enum against a list, not a literal
// equality check, so this reads the same as `priority`/`sort`/`order` and
// needs no special-casing if Lab 3 adds a second status.
export const TICKET_STATUSES = ['NEW'] as const;
export type TicketStatusFilter = (typeof TICKET_STATUSES)[number];

export const PAGE_SIZES = [10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

const DEFAULT_SORT: SortField = 'createdAt';
const DEFAULT_ORDER: SortOrder = 'desc';
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE: PageSize = 10;

/**
 * Largest value Postgres `int4` can hold. Mirrors the same constant in
 * `requesterContext.ts` and `routes/tickets.ts`: an id-shaped query value
 * larger than this can never reference any row and querying with it raises
 * a driver-level range error rather than a clean "no match" — so it is
 * bounds-checked here, in the pure parser, before any query is ever built.
 */
const PG_INT4_MAX = 2_147_483_647;

export interface TicketListQuery {
  search?: string;
  categoryId?: number;
  priority?: Priority;
  status?: TicketStatusFilter;
  sort: SortField;
  order: SortOrder;
  page: number;
  pageSize: PageSize;
}

export type TicketListQueryResult =
  | { ok: true; value: TicketListQuery }
  | { ok: false; errors: FieldError[] };

/**
 * Collapses one query-string value to a single trimmed string.
 *
 * Returns `undefined` when the param was absent, or present but
 * blank/whitespace-only. §3.2 states that rule explicitly only for
 * `search` ("blank/whitespace-only search is treated as no search",
 * BR-16); this parser applies the same reading uniformly to every param —
 * `?priority=&page=` is naturally read as "the caller didn't specify
 * these", not as a rejection of an empty string.
 *
 * Returns `null` when the raw value isn't a single plain string at all —
 * e.g. Express/`qs` parses a repeated `?sort=a&sort=b` into an array, or a
 * bracketed `?sort[x]=a` into an object. Silently picking `raw[0]` or
 * stringifying an object would be exactly the kind of coercion BR-19/FR-29
 * forbid, so callers treat `null` as a shape failure for that field.
 */
function singleTrimmedValue(raw: unknown): string | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
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
  return { ok: true, value };
}

/**
 * `categoryId`: §3.2 says an unknown/inactive value ⇒ `400` here (unlike
 * `POST /api/tickets`'s `404` for the same reference — see the router's
 * comment for why the two endpoints differ). This function only rejects
 * values that are not even shape-valid (not digits-only, or too large to
 * ever be a real `Category.id`); the router performs the actual
 * active-category lookup and maps "not found" to the same `INVALID_QUERY`
 * error afterward.
 */
function parseCategoryId(raw: unknown): ParamResult<number> {
  const value = singleTrimmedValue(raw);
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || !/^\d+$/.test(value)) {
    return { ok: false, error: { field: 'categoryId', message: 'categoryId must be an integer.' } };
  }
  const num = Number(value);
  // Ambiguity resolution (see file header / task brief): a syntactically
  // valid positive integer that exceeds int4 range cannot reference any
  // Category row, so it is treated the same as an unknown category id —
  // 400 INVALID_QUERY — rather than being handed to the database, which
  // would raise "value out of range for type integer" and surface as an
  // unrelated 500. Same reasoning as requesterContext.ts's X-Requester-Id
  // bound and tickets.ts's categoryId/relatedSystemId bound on create.
  if (!Number.isSafeInteger(num) || num > PG_INT4_MAX) {
    return {
      ok: false,
      error: { field: 'categoryId', message: 'categoryId does not reference a known active category.' },
    };
  }
  return { ok: true, value: num };
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

function parsePageSize(raw: unknown): ParamResult<PageSize> {
  const value = singleTrimmedValue(raw);
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || !/^\d+$/.test(value)) {
    return { ok: false, error: { field: 'pageSize', message: 'pageSize must be one of 10, 20, 50.' } };
  }
  const num = Number(value);
  if (!(PAGE_SIZES as readonly number[]).includes(num)) {
    return { ok: false, error: { field: 'pageSize', message: 'pageSize must be one of 10, 20, 50.' } };
  }
  return { ok: true, value: num as PageSize };
}

/**
 * Parses and shape-validates every `GET /api/tickets` query param
 * (api-spec.md §3.2). On success, every field is either its parsed value or
 * its documented default — never `undefined` for `sort`/`order`/`page`/
 * `pageSize`, which always default. On failure, `errors` lists one entry
 * per rejected param (possibly more than one at once), for the
 * `400 INVALID_QUERY` body's `fields[]`.
 */
export function parseTicketListQuery(query: Record<string, unknown>): TicketListQueryResult {
  const searchResult = parseSearch(query.search);
  const categoryIdResult = parseCategoryId(query.categoryId);
  const priorityResult = parseEnumParam('priority', query.priority, PRIORITIES, 'priority must be one of LOW, MEDIUM, HIGH.');
  const statusResult = parseEnumParam('status', query.status, TICKET_STATUSES, 'status must be NEW.');
  const sortResult = parseEnumParam('sort', query.sort, SORT_FIELDS, 'sort must be one of createdAt, updatedAt, ticketNumber.');
  const orderResult = parseEnumParam('order', query.order, SORT_ORDERS, 'order must be one of asc, desc.');
  const pageResult = parsePage(query.page);
  const pageSizeResult = parsePageSize(query.pageSize);

  const errors: FieldError[] = [];
  if (!searchResult.ok) errors.push(searchResult.error);
  if (!categoryIdResult.ok) errors.push(categoryIdResult.error);
  if (!priorityResult.ok) errors.push(priorityResult.error);
  if (!statusResult.ok) errors.push(statusResult.error);
  if (!sortResult.ok) errors.push(sortResult.error);
  if (!orderResult.ok) errors.push(orderResult.error);
  if (!pageResult.ok) errors.push(pageResult.error);
  if (!pageSizeResult.ok) errors.push(pageSizeResult.error);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Every *Result is `ok: true` at this point (errors is empty).
  const search = (searchResult as Extract<typeof searchResult, { ok: true }>).value;
  const categoryId = (categoryIdResult as Extract<typeof categoryIdResult, { ok: true }>).value;
  const priority = (priorityResult as Extract<typeof priorityResult, { ok: true }>).value;
  const status = (statusResult as Extract<typeof statusResult, { ok: true }>).value;
  const sort = (sortResult as Extract<typeof sortResult, { ok: true }>).value ?? DEFAULT_SORT;
  const order = (orderResult as Extract<typeof orderResult, { ok: true }>).value ?? DEFAULT_ORDER;
  const page = (pageResult as Extract<typeof pageResult, { ok: true }>).value ?? DEFAULT_PAGE;
  const pageSize = (pageSizeResult as Extract<typeof pageSizeResult, { ok: true }>).value ?? DEFAULT_PAGE_SIZE;

  return {
    ok: true,
    value: { search, categoryId, priority, status, sort, order, page, pageSize },
  };
}
