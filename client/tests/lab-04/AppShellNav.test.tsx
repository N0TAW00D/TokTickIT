import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "../../src/shell/AppShell.tsx";
import { RoleLandingRedirect } from "../../src/routes/RoleLandingRedirect.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser, Role } from "../../src/auth/api.ts";

// Covers docs/lab-04/tests.md C-01 (navigation per role, Dashboard first,
// aria-current on /dashboard, wordmark -> /dashboard) and C-02 (role landing
// redirect: `/` -> `/dashboard` for every role), ui-spec.md §2, D-12.

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

function renderShell(role: Role, path: string) {
  return render(
    <AuthProvider>
      <AuthBootstrap user={makeUser(role)}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="*"
              element={
                <AppShell>
                  <h1>Screen content</h1>
                </AppShell>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

function renderLanding(role: Role) {
  return render(
    <AuthProvider>
      <AuthBootstrap user={makeUser(role)}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<RoleLandingRedirect />} />
            <Route path="/dashboard" element={<h1>Dashboard landing</h1>} />
            <Route path="*" element={<h1>Wrong landing</h1>} />
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

const EXPECTED_NAV: Record<Role, [string, string][]> = {
  REQUESTER: [
    ["Dashboard", "/dashboard"],
    ["My Tickets", "/tickets"],
    ["Create Ticket", "/tickets/new"],
  ],
  IT_STAFF: [
    ["Dashboard", "/dashboard"],
    ["Ticket Queue", "/staff/tickets"],
  ],
  ADMINISTRATOR: [
    ["Dashboard", "/dashboard"],
    ["Ticket Queue", "/staff/tickets"],
    ["User Management", "/admin/users"],
  ],
};

describe("C-01 navigation per role (ui-spec.md §2)", () => {
  it.each<Role>(["REQUESTER", "IT_STAFF", "ADMINISTRATOR"])(
    "%s sees exactly its destinations, in order, with Dashboard first",
    async (role) => {
      renderShell(role, "/dashboard");
      await screen.findByRole("heading", { name: "Screen content" });
      const nav = screen.getByRole("navigation", { name: "Primary" });
      const links = within(nav).getAllByRole("link");
      expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual(
        EXPECTED_NAV[role],
      );
    },
  );

  it("marks Dashboard aria-current=page only on /dashboard", async () => {
    renderShell("REQUESTER", "/dashboard");
    await screen.findByRole("heading", { name: "Screen content" });
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "My Tickets" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("does not mark Dashboard active on the list pages; the list stays active on its own route", async () => {
    renderShell("REQUESTER", "/tickets");
    await screen.findByRole("heading", { name: "Screen content" });
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(within(nav).getByRole("link", { name: "My Tickets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it.each<Role>(["REQUESTER", "IT_STAFF", "ADMINISTRATOR"])(
    "the wordmark links to /dashboard for %s",
    async (role) => {
      renderShell(role, "/anywhere");
      await screen.findByRole("heading", { name: "Screen content" });
      expect(screen.getByRole("link", { name: /TokTickIT/ })).toHaveAttribute(
        "href",
        "/dashboard",
      );
    },
  );
});

describe("C-02 role landing redirect (D-12)", () => {
  it.each<Role>(["REQUESTER", "IT_STAFF", "ADMINISTRATOR"])(
    "/ navigates a %s to /dashboard",
    async (role) => {
      renderLanding(role);
      expect(await screen.findByRole("heading", { name: "Dashboard landing" })).toBeInTheDocument();
    },
  );
});
