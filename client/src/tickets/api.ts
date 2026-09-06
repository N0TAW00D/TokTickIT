const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export interface ReferenceOption {
  id: number;
  name: string;
}

/**
 * `GET /api/categories` (api-spec.md §2.1): active ticket categories for
 * the Create Ticket classification control. Not Requester-scoped.
 */
export async function fetchCategories(): Promise<ReferenceOption[]> {
  const response = await fetch(`${API_BASE_URL}/api/categories`);
  if (!response.ok) {
    throw new Error(`Failed to load categories (status ${response.status})`);
  }
  return response.json();
}

/**
 * `GET /api/related-systems` (api-spec.md §2.2): active related systems.
 * Not Requester-scoped.
 */
export async function fetchRelatedSystems(): Promise<ReferenceOption[]> {
  const response = await fetch(`${API_BASE_URL}/api/related-systems`);
  if (!response.ok) {
    throw new Error(
      `Failed to load related systems (status ${response.status})`,
    );
  }
  return response.json();
}

export type RequestedPriority = "LOW" | "MEDIUM" | "HIGH";

export interface CreateTicketRequest {
  categoryId: number;
  relatedSystemId: number;
  requestedPriority: RequestedPriority;
  summary: string;
  description: string;
}

export interface CreateTicketResponse {
  id: number;
  ticketNumber: string;
  requester: { id: number; name: string; email: string };
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
  requestedPriority: RequestedPriority;
  status: string;
  summary: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  attachments: unknown[];
}

/**
 * `POST /api/tickets` (api-spec.md §3.1): create one ticket for the current
 * Requester, identified via the `X-Requester-Id` header (§1.2) rather than
 * the request body.
 */
export async function createTicket(
  requesterId: number,
  payload: CreateTicketRequest,
): Promise<CreateTicketResponse> {
  const response = await fetch(`${API_BASE_URL}/api/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requester-Id": String(requesterId),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to create ticket (status ${response.status})`);
  }
  return response.json();
}
