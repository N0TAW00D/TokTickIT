import type { Role } from "../auth/api";
import type { ItPriority, StaffQueueStatus } from "../staff/api";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/** A ticket row on the Requester dashboard (api-spec.md §4) — never carries IT Priority, owner or Internal data. */
export interface RequesterDashboardTicket {
  id: number;
  ticketNumber: string;
  summary: string;
  status: string;
  updatedAt: string;
  /** Only on `recentlyResolved` items. */
  resolvedAt?: string;
}

export interface RequesterDashboardResponse {
  generatedAt: string;
  timeZone: string;
  windowStart: string;
  metrics: { openTickets: number; waitingForMe: number };
  recentlyUpdated: { total: number; items: RequesterDashboardTicket[] };
  recentlyResolved: { total: number; items: RequesterDashboardTicket[] };
}

/** A ticket row on the IT Staff dashboard's Urgent / Recently Updated lists (api-spec.md §5). */
export interface StaffDashboardTicket {
  id: number;
  ticketNumber: string;
  summary: string;
  status: StaffQueueStatus;
  itPriority: ItPriority;
  owner: { id: number; name: string } | null;
  updatedAt: string;
}

export type DashboardActionStatus = "PLANNED" | "IN_PROGRESS";

export interface DashboardOpenAction {
  id: number;
  ticketId: number;
  ticketNumber: string;
  description: string;
  status: DashboardActionStatus | (string & {});
  actionAt: string;
  followUpRequired: boolean;
}

export interface StaffDashboardResponse {
  generatedAt: string;
  timeZone: string;
  windowStart: string;
  metrics: {
    unassigned: number;
    ownedByMe: number;
    urgent: number;
    followUpsRequired: number;
  };
  byStatus: Record<StaffQueueStatus, number>;
  byItPriority: Record<ItPriority, number>;
  myOpenActions: { actions: number; tickets: number; items: DashboardOpenAction[] };
  urgentTickets: { total: number; items: StaffDashboardTicket[] };
  recentlyUpdated: { total: number; items: StaffDashboardTicket[] };
  /** Administrator callers only (BR-32). */
  userCounts?: { role: Role; active: number; inactive: number }[];
}

/**
 * Thrown on a `403` from a dashboard endpoint (e.g. the role changed
 * mid-session). The screen renders the forbidden state instead of an error.
 */
export class DashboardForbiddenError extends Error {
  constructor() {
    super("The dashboard is not available to this role.");
    this.name = "DashboardForbiddenError";
  }
}

async function fetchDashboard<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
  if (response.status === 403) throw new DashboardForbiddenError();
  if (!response.ok) {
    throw new Error(`Failed to load the dashboard (status ${response.status})`);
  }
  return response.json();
}

/** `GET /api/dashboard/requester` (api-spec.md §4) — Requester only. */
export function fetchRequesterDashboard(): Promise<RequesterDashboardResponse> {
  return fetchDashboard("/api/dashboard/requester");
}

/** `GET /api/dashboard/staff` (api-spec.md §5) — IT Staff and Administrator. */
export function fetchStaffDashboard(): Promise<StaffDashboardResponse> {
  return fetchDashboard("/api/dashboard/staff");
}
