const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export interface RequesterSummary {
  id: number;
  name: string;
  email: string;
}

/**
 * `GET /api/requesters` (api-spec.md §2.3): active Development Requesters,
 * ordered by name. Not Requester-scoped — no `X-Requester-Id` header.
 *
 * Used by both the Requester Selection screen (its own loading / empty /
 * error states) and the route guard, which re-validates a stored id against
 * this same list on every app load (BR-10).
 */
export async function fetchRequesters(): Promise<RequesterSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/requesters`);
  if (!response.ok) {
    throw new Error(`Failed to load requesters (status ${response.status})`);
  }
  return response.json();
}
