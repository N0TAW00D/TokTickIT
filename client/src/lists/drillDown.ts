import type { ItPriority, StaffQueueStatus, StaffSortDirection, StaffSortField } from "../staff/api";
import type { SortOrder, TicketSortField } from "../tickets/api";

/**
 * URL <-> filter-state mapping for the drill-down parameters the dashboards
 * link with (lab-04 api-spec.md §6, ui-spec.md §2). Unknown or malformed
 * values are dropped, never forwarded: the API would answer them with
 * `400 INVALID_QUERY` and a hand-edited URL should degrade to "no filter".
 */

export const TICKET_STATUS_VALUES: readonly StaffQueueStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
];

const IT_PRIORITIES: readonly ItPriority[] = ["LOW", "MEDIUM", "HIGH"];

export type RequesterScope = "open" | "recent" | "recently-resolved";
export type StaffScope = "open" | "recent";

const REQUESTER_SCOPES: readonly RequesterScope[] = ["open", "recent", "recently-resolved"];
const STAFF_SCOPES: readonly StaffScope[] = ["open", "recent"];
const REQUESTER_SORTS: readonly TicketSortField[] = ["createdAt", "updatedAt", "ticketNumber"];
const STAFF_SORTS: readonly StaffSortField[] = ["createdAt", "updatedAt", "itPriority", "ticketNumber"];
const DIRECTIONS: readonly StaffSortDirection[] = ["asc", "desc"];

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | "" {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

function setIf(params: URLSearchParams, key: string, value: string | boolean) {
  if (value === "" || value === false) return;
  params.set(key, value === true ? "true" : value);
}

// ---- Requester: My Tickets ------------------------------------------------

export interface RequesterListQuery {
  scope: RequesterScope | "";
  status: StaffQueueStatus | "";
  sort: TicketSortField | "";
  order: SortOrder | "";
}

export function parseRequesterQuery(params: URLSearchParams): RequesterListQuery {
  return {
    scope: oneOf(params.get("scope"), REQUESTER_SCOPES),
    status: oneOf(params.get("status"), TICKET_STATUS_VALUES),
    sort: oneOf(params.get("sort"), REQUESTER_SORTS),
    order: oneOf(params.get("order"), DIRECTIONS),
  };
}

/** Serialises only non-default values; `sort`/`order` are included together once either differs from the default. */
export function serializeRequesterQuery(
  query: { scope: string; status: string },
  sort: { value: string; order: string; isDefault: boolean },
): string {
  const params = new URLSearchParams();
  setIf(params, "scope", query.scope);
  setIf(params, "status", query.status);
  if (!sort.isDefault) {
    params.set("sort", sort.value);
    params.set("order", sort.order);
  }
  return params.toString();
}

// ---- IT Staff: Ticket Queue ------------------------------------------------

export interface StaffListQuery {
  scope: StaffScope | "";
  status: StaffQueueStatus | "";
  /** "unassigned", "me" or a numeric user id as a string. */
  owner: string;
  itPriority: ItPriority | "";
  myActions: boolean;
  followUp: boolean;
  sort: StaffSortField | "";
  direction: StaffSortDirection | "";
}

export function parseStaffQuery(params: URLSearchParams): StaffListQuery {
  const owner = params.get("owner");
  return {
    scope: oneOf(params.get("scope"), STAFF_SCOPES),
    status: oneOf(params.get("status"), TICKET_STATUS_VALUES),
    owner: owner !== null && (owner === "unassigned" || owner === "me" || /^\d+$/.test(owner)) ? owner : "",
    itPriority: oneOf(params.get("itPriority"), IT_PRIORITIES),
    myActions: params.get("myActions") === "true",
    followUp: params.get("followUp") === "true",
    sort: oneOf(params.get("sort"), STAFF_SORTS),
    direction: oneOf(params.get("direction"), DIRECTIONS),
  };
}

export function serializeStaffQuery(
  query: Pick<StaffListQuery, "scope" | "status" | "owner" | "itPriority" | "myActions" | "followUp">,
  sort: { value: string; direction: string; isDefault: boolean },
): string {
  const params = new URLSearchParams();
  setIf(params, "scope", query.scope);
  setIf(params, "status", query.status);
  setIf(params, "owner", query.owner);
  setIf(params, "itPriority", query.itPriority);
  setIf(params, "myActions", query.myActions);
  setIf(params, "followUp", query.followUp);
  if (!sort.isDefault) {
    params.set("sort", sort.value);
    params.set("direction", sort.direction);
  }
  return params.toString();
}

// ---- Chip labels -------------------------------------------------------------

export const SCOPE_LABEL: Record<RequesterScope, string> = {
  open: "Open tickets",
  recent: "Updated in the last 7 days",
  "recently-resolved": "Resolved in the last 7 days",
};
