const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/** One row of `GET /api/tickets/:id/status-history` (lab-04/api-spec.md §3.4). */
export interface StatusChangeEntry {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  changedBy: { id: number; name: string; role: string };
  changedAt: string;
}

/** `GET /api/tickets/:id/status-history`: oldest first (BR-14); `[]` for a Ticket never changed. */
export async function fetchStatusHistory(
  ticketId: number,
): Promise<StatusChangeEntry[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/tickets/${ticketId}/status-history`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`Failed to load status history (status ${response.status})`);
  }
  return response.json();
}

/**
 * The slice of an Action Taken (api-spec.md §2.1) the resolution checklist
 * needs. The Actions Taken card itself is a separate screen concern.
 */
export interface ActionSummary {
  id: number;
  status: string;
}

/** `GET /api/tickets/:id/actions-taken`, read only to compute the resolution checklist. */
export async function fetchActionSummaries(
  ticketId: number,
): Promise<ActionSummary[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/tickets/${ticketId}/actions-taken`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`Failed to load actions taken (status ${response.status})`);
  }
  return response.json();
}
