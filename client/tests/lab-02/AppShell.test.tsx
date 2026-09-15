import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "../../src/shell/AppShell.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";

// Covers docs/lab-02/tests.md C-07's shell-layout half: the active nav link
// carries `aria-current="page"`. C-07's other half — showing the current
// Requester and a "Change Requester" action — asserted the Development
// Requester selector, which issue #70 deletes entirely
// (specification.md §7.4 item 8); that identity display is now
// `UserBadge`, covered by client/tests/lab-03/AppShell.test.tsx's own
// role-navigation suite. This file is re-pointed onto real session
// identity (`AuthProvider`) rather than the deleted `RequesterProvider`,
// per AC-19: the underlying Lab 2 behavior (shell layout / active-link
// marking) keeps being asserted, without a `RequesterBadge`/"Change
// Requester" expectation that no longer exists.

const REQUESTER_USER: AuthUser = {
  id: 1,
  name: "Jennifer Anderson",
  email: "jennifer.anderson@example.edu",
  role: "REQUESTER",
  mustChangePassword: false,
};

/** Seeds AuthContext with a known authenticated Requester before AppShell mounts. */
function AuthBootstrap({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) setUser(REQUESTER_USER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

function renderHarness() {
  return render(
    <AuthProvider>
      <AuthBootstrap>
        <MemoryRouter initialEntries={["/tickets"]}>
          <Routes>
            <Route
              path="/tickets"
              element={
                <AppShell>
                  <h1>My Tickets</h1>
                </AppShell>
              }
            />
            <Route
              path="/tickets/new"
              element={
                <AppShell>
                  <h1>Create Ticket</h1>
                </AppShell>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("C-07 app shell", () => {
  it('shows the authenticated user\'s name and marks the active nav link with aria-current="page"', () => {
    renderHarness();

    expect(
      screen.getByRole("heading", { name: "My Tickets" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Jennifer Anderson")).toBeInTheDocument();

    const myTicketsLink = screen.getByRole("link", { name: "My Tickets" });
    expect(myTicketsLink).toHaveAttribute("aria-current", "page");

    const createTicketLink = screen.getByRole("link", {
      name: "Create Ticket",
    });
    expect(createTicketLink).not.toHaveAttribute("aria-current");
  });
});
