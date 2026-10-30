import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { StaffTicketDetailScreen } from "../../src/screens/StaffTicketDetailScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";

// D-13 / ui-spec.md §5.1: on Staff Ticket Detail an Administrator gets no owner
// select, status control, comment composer or note composer; IT Priority stays.

const BASE = "http://localhost:3000";
const ID = 21;

const TICKET = {
  id: ID,
  ticketNumber: "TKT-2026-000021",
  requester: { id: 7, name: "Jennifer Anderson", email: "j@example.edu" },
  category: { id: 4, name: "Network" },
  relatedSystem: { id: 7, name: "Corporate Laptop" },
  requestedPriority: "MEDIUM",
  itPriority: "HIGH",
  status: "OPEN",
  owner: { id: 9, name: "Jordan Lee" },
  requesterResolvedAt: null,
  summary: "Printer not connecting to network",
  description: "The printer disconnects.",
  createdAt: "2026-09-01T08:14:00.000Z",
  updatedAt: "2026-09-05T09:30:00.000Z",
  attachments: [],
};

function json(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input === `${BASE}/api/tickets/${ID}`) return json(TICKET);
      return json([]);
    }),
  );
}

function AuthBootstrap({ children, seedUser }: { children: ReactNode; seedUser: AuthUser }) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) setUser(seedUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

function renderAs(role: AuthUser["role"]) {
  const user: AuthUser = {
    id: 15,
    name: "Casey Morgan",
    email: "casey@example.edu",
    role,
    mustChangePassword: false,
  };
  return render(
    <AuthProvider>
      <AuthBootstrap seedUser={user}>
        <MemoryRouter initialEntries={[`/staff/tickets/${ID}`]}>
          <Routes>
            <Route path="/staff/tickets/:id" element={<StaffTicketDetailScreen />} />
          </Routes>
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Staff Ticket Detail as Administrator", () => {
  it("D-13: hides owner, status and both composers but keeps IT Priority", async () => {
    mockFetch();
    renderAs("ADMINISTRATOR");
    await screen.findByText("TKT-2026-000021");
    await screen.findByText(/No comments yet/i);

    expect(screen.getByText("IT Priority")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ticket Owner")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Current Status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a comment")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add an internal note")).not.toBeInTheDocument();
  });

  it("D-13: IT Staff still sees every control and both composers", async () => {
    mockFetch();
    renderAs("IT_STAFF");
    await screen.findByText("TKT-2026-000021");
    await screen.findByText(/No comments yet/i);

    expect(screen.getByLabelText("Ticket Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Current Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a comment")).toBeInTheDocument();
    expect(screen.getByLabelText("Add an internal note")).toBeInTheDocument();
  });
});
