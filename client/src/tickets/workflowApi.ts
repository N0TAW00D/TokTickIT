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
