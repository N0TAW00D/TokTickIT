import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { RequireRole } from "../../src/routes/RequireRole.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser, Role } from "../../src/auth/api.ts";

// Covers docs/lab-03/ui-spec.md §4.3 (forbidden state), specification.md
// FR-10/FR-12/FR-13/AC-15/AC-17/AC-18, and tests.md's C-09 ("forbidden
// route: forbidden state renders and, via request interception, no
// protected request is issued") at the component level — `RequireRole`
// itself, independent of any real screen (#71/#73 haven't built one yet).

/** Seeds AuthContext with a known user before RequireRole mounts — same pattern as client/tests/lab-03/ChangePassword.test.tsx's AuthBootstrap. */
function AuthBootstrap({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  const { user: current, setUser } = useAuth();
  useEffect(() => {
    if (user !== null && current === null) setUser(user);
    // Seed once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // For the "no user" case there is nothing to wait for — render immediately
  // so RequireAuth's own unauthenticated fetch path is what's exercised.
  if (user === null) return <>{children}</>;
  if (!current) return null;
  return <>{children}</>;
}

function makeUser(role: Role, overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    name: "Test User",
    email: "test.user@example.edu",
    role,
    mustChangePassword: false,
    ...overrides,
  };
}

/** A stand-in "protected screen" that proves whether it was ever mounted (and whether it ever fetched anything). */
function ProtectedScreen({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <h1>Protected content</h1>;
}

function renderGuard(user: AuthUser | null, allowedRoles: Role[], onProtectedMount: () => void) {
  return render(
    <AuthProvider>
      <AuthBootstrap user={user}>
        <MemoryRouter initialEntries={["/guarded"]}>
          <Routes>
            <Route
              path="/guarded"
              element={
                <RequireRole allowedRoles={allowedRoles}>
                  <ProtectedScreen onMount={onProtectedMount} />
                </RequireRole>
              }
            />
            <Route path="/login" element={<h1>Login</h1>} />
            <Route path="/change-password" element={<h1>Change password</h1>} />
            <Route path="/tickets" element={<h1>My Tickets landing</h1>} />
            <Route path="/staff/tickets" element={<h1>Ticket Queue landing</h1>} />
            <Route path="/admin/users" element={<h1>User Management landing</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RequireRole — allowed role", () => {
  it.each<[Role, Role[]]>([
    ["REQUESTER", ["REQUESTER"]],
    ["IT_STAFF", ["IT_STAFF"]],
    ["ADMINISTRATOR", ["ADMINISTRATOR"]],
    ["IT_STAFF", ["IT_STAFF", "ADMINISTRATOR"]],
  ])("renders the wrapped screen for a %s caller when allowedRoles is %j", async (role, allowedRoles) => {
    const onMount = vi.fn();
    renderGuard(makeUser(role), allowedRoles, onMount);

    expect(await screen.findByRole("heading", { name: "Protected content" })).toBeInTheDocument();
    expect(onMount).toHaveBeenCalledOnce();
  });
});

describe("RequireRole — disallowed role (ui-spec.md §4.3 forbidden state)", () => {
  it.each<[Role, Role[]]>([
    ["REQUESTER", ["IT_STAFF"]],
    ["REQUESTER", ["ADMINISTRATOR"]],
    ["IT_STAFF", ["REQUESTER"]],
    ["IT_STAFF", ["ADMINISTRATOR"]],
    ["ADMINISTRATOR", ["REQUESTER"]],
    ["ADMINISTRATOR", ["IT_STAFF"]],
  ])("shows the forbidden state, not the screen, for a %s caller when allowedRoles is %j", async (role, allowedRoles) => {
    const onMount = vi.fn();
    renderGuard(makeUser(role), allowedRoles, onMount);

    expect(await screen.findByRole("heading", { name: "You don't have access to this page" })).toBeInTheDocument();
    expect(screen.getByText(/your account's role doesn't include this destination/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Protected content" })).not.toBeInTheDocument();
  });

  it("AC-18: never mounts the wrapped screen, so its data-fetch effect never runs", async () => {
    const onMount = vi.fn();
    renderGuard(makeUser("REQUESTER"), ["ADMINISTRATOR"], onMount);

    await screen.findByRole("heading", { name: "You don't have access to this page" });
    expect(onMount).not.toHaveBeenCalled();
  });

  it("links back to the caller's OWN landing page — a Requester forbidden from an Admin route links to My Tickets", async () => {
    renderGuard(makeUser("REQUESTER"), ["ADMINISTRATOR"], vi.fn());
    await screen.findByRole("heading", { name: "You don't have access to this page" });

    const link = screen.getByRole("link", { name: /my tickets/i });
    expect(link).toHaveAttribute("href", "/tickets");
  });

  it("links to Ticket Queue for an IT Staff caller forbidden from an Admin route", async () => {
    renderGuard(makeUser("IT_STAFF"), ["ADMINISTRATOR"], vi.fn());
    await screen.findByRole("heading", { name: "You don't have access to this page" });

    const link = screen.getByRole("link", { name: /ticket queue/i });
    expect(link).toHaveAttribute("href", "/staff/tickets");
  });

  it("links to User Management for an Administrator caller forbidden from a Requester route", async () => {
    renderGuard(makeUser("ADMINISTRATOR"), ["REQUESTER"], vi.fn());
    await screen.findByRole("heading", { name: "You don't have access to this page" });

    const link = screen.getByRole("link", { name: /user management/i });
    expect(link).toHaveAttribute("href", "/admin/users");
  });
});

describe("RequireRole preserves RequireAuth's existing behaviour unchanged", () => {
  it("no session -> redirected to /login, exactly like RequireAuth alone (issue #68 behaviour)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response)),
    );
    const onMount = vi.fn();
    renderGuard(null, ["REQUESTER"], onMount);

    expect(await screen.findByRole("heading", { name: "Login" })).toBeInTheDocument();
    expect(onMount).not.toHaveBeenCalled();
  });

  it("mustChangePassword=true -> redirected to /change-password, even though the role is allowed", async () => {
    const onMount = vi.fn();
    renderGuard(makeUser("REQUESTER", { mustChangePassword: true }), ["REQUESTER"], onMount);

    expect(await screen.findByRole("heading", { name: "Change password" })).toBeInTheDocument();
    expect(onMount).not.toHaveBeenCalled();
  });
});
