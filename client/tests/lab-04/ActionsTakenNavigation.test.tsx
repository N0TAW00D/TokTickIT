import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { StaffTicketDetailScreen } from "../../src/screens/StaffTicketDetailScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";

// Staff Ticket Detail: a late Actions Taken / Status history response from the
// previous ticket must never replace the rows of the ticket now on screen.

function res(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function ticketBody(id: number) {
  return {
    id,
    ticketNumber: `TKT-2026-00000${id}`,
    requester: { id: 7, name: "Jennifer Anderson", email: "j@example.edu" },
    category: { id: 4, name: "Network" },
    relatedSystem: { id: 7, name: "Corporate Laptop" },
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    status: "IN_PROGRESS",
    owner: { id: 9, name: "Jordan Lee" },
    requesterResolvedAt: null,
    summary: "Printer not connecting to network",
    description: "The printer disconnects every few minutes.",
    createdAt: "2026-09-01T08:14:00.000Z",
    updatedAt: "2026-09-05T09:30:00.000Z",
    attachments: [],
    version: 3,
  };
}

function actionBody(ticketId: number, description: string) {
  return {
    id: ticketId * 10,
    ticketId,
    actionAt: "2026-10-01T03:00:00.000Z",
    description,
    result: null,
    status: "PLANNED",
    performedBy: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
    assignee: null,
    followUpRequired: false,
    followUpNote: null,
    attachmentNotes: null,
    lastUpdatedBy: { id: 9, name: "Jordan Lee" },
    createdAt: "2026-10-01T03:05:00.000Z",
    updatedAt: "2026-10-01T03:05:00.000Z",
    version: 1,
  };
}

function change(id: number, name: string) {
  return {
    id,
    fromStatus: "NEW",
    toStatus: "IN_PROGRESS",
    changedBy: { id, name },
    changedAt: "2026-09-02T08:00:00.000Z",
  };
}

function Bootstrap({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) {
      setUser({
        id: 9,
        name: "Jordan Lee",
        email: "jordan.lee@example.edu",
        role: "IT_STAFF",
        mustChangePassword: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Staff Ticket Detail: navigating between tickets with reads in flight", () => {
  it("drops A's late Actions Taken and history responses after B's rows are shown", async () => {
    const pending: Record<string, (r: Response) => void> = {};
    const ok = (body: unknown) =>
      ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        if (input.endsWith("/api/staff/assignable-users")) return res(200, []);
        const m = /\/api\/tickets\/(\d+)(?:\/(.*))?$/.exec(input);
        if (!m || (init?.method && init.method !== "GET")) return res(404, {});
        const [, id, rest] = m;
        if (!rest) return res(200, ticketBody(Number(id)));
        if (rest === "comments" || rest === "notes") return res(200, []);
        if (id === "1") {
          return new Promise<Response>((resolve) => (pending[rest] = resolve));
        }
        if (rest === "actions-taken") return res(200, [actionBody(2, "B action")]);
        return res(200, [change(2, "Bea Bravo")]);
      }),
    );

    render(
      <AuthProvider>
        <Bootstrap>
          <MemoryRouter initialEntries={["/staff/tickets/1"]}>
            <Link to="/staff/tickets/2">go to B</Link>
            <Routes>
              <Route path="/staff/tickets/:id" element={<StaffTicketDetailScreen />} />
            </Routes>
          </MemoryRouter>
        </Bootstrap>
      </AuthProvider>,
    );
    await screen.findByText("TKT-2026-000001");
    await vi.waitFor(() => expect(Object.keys(pending)).toHaveLength(2));

    fireEvent.click(screen.getByText("go to B"));
    expect(await screen.findByText("B action")).toBeInTheDocument();
    expect(await screen.findByText(/Bea Bravo/)).toBeInTheDocument();

    pending["actions-taken"](ok([actionBody(1, "A action")]));
    pending["status-history"](ok([change(1, "Al Alpha")]));
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.getByText("B action")).toBeInTheDocument();
    expect(screen.queryByText("A action")).toBeNull();
    expect(screen.getByText(/Bea Bravo/)).toBeInTheDocument();
    expect(screen.queryByText(/Al Alpha/)).toBeNull();
  });
});
