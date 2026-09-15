import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "../../src/shell/AppShell.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import { RequesterProvider } from "../../src/requester/RequesterContext.tsx";
import type { AuthUser, Role } from "../../src/auth/api.ts";

// Covers docs/lab-03/ui-spec.md §4.2 (role-specific navigation) and
// tests.md's C-07 ("Role navigation: each role renders only its own
// destinations; others are absent, not disabled"). The unauthenticated and
// forbidden-route halves (C-09/AC-18) are covered at the RequireRole level
// in client/tests/lab-03/RequireRole.test.tsx, since #71/#73 haven't built
// a real IT Staff/Administrator screen for AppShell to wrap yet — see that
// file's own header comment.

/** Seeds AuthContext with a known user before AppShell mounts. */
function AuthBootstrap({ user, children }: { user: AuthUser; children: ReactNode }) {
  const { user: current, setUser } = useAuth();
  useEffect(() => {
    if (!current) setUser(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!current) return null;
  return <>{children}</>;
}

function makeUser(role: Role): AuthUser {
  return {
    id: 1,
    name: "Test User",
    email: "test.user@example.edu",
    role,
    mustChangePassword: false,
  };
}

function renderShellForRole(role: Role) {
  return render(
    <AuthProvider>
      <AuthBootstrap user={makeUser(role)}>
        {/* AppShell always mounts RequesterBadge regardless of the
            authenticated role — a pre-existing #68 requirement (see
            AppShell.tsx's own comment), unrelated to nav. */}
        <RequesterProvider>
          <MemoryRouter initialEntries={["/tickets"]}>
            <Routes>
              <Route
                path="/tickets"
                element={
                  <AppShell>
                    <h1>Screen content</h1>
                  </AppShell>
                }
              />
            </Routes>
          </MemoryRouter>
        </RequesterProvider>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("C-07 role-specific navigation (ui-spec.md §4.2)", () => {
  it("Requester sees exactly My Tickets and Create Ticket — no Ticket Queue, no User Management", async () => {
    renderShellForRole("REQUESTER");
    await screen.findByRole("heading", { name: "Screen content" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "My Tickets" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Create Ticket" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Ticket Queue" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "User Management" })).not.toBeInTheDocument();
  });

  it("IT Staff sees exactly Ticket Queue — no My Tickets, no Create Ticket, no User Management (FR-12)", async () => {
    renderShellForRole("IT_STAFF");
    await screen.findByRole("heading", { name: "Screen content" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Ticket Queue" })).toHaveAttribute("href", "/staff/tickets");
    expect(within(nav).queryByRole("link", { name: "My Tickets" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Create Ticket" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "User Management" })).not.toBeInTheDocument();
  });

  it("Administrator sees exactly User Management — no My Tickets, no Create Ticket, no Ticket Queue (FR-12)", async () => {
    renderShellForRole("ADMINISTRATOR");
    await screen.findByRole("heading", { name: "Screen content" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "User Management" })).toHaveAttribute("href", "/admin/users");
    expect(within(nav).queryByRole("link", { name: "My Tickets" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Create Ticket" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Ticket Queue" })).not.toBeInTheDocument();
  });

  it("a destination a role may not reach is absent entirely, not disabled (ui-spec.md §4.2)", async () => {
    renderShellForRole("IT_STAFF");
    await screen.findByRole("heading", { name: "Screen content" });

    // Not just "not a link" — not present in any form (e.g. a disabled
    // control, greyed text) that a hidden-but-rendered destination might take.
    expect(screen.queryByText("My Tickets")).not.toBeInTheDocument();
    expect(screen.queryByText("Create Ticket")).not.toBeInTheDocument();
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
  });
});
