import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { UserBadge } from "../../src/shell/UserBadge.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";

// Covers docs/lab-03/ui-spec.md §4.1 (UserBadge) and tests.md's C-08:
// "Shows name and RoleBadge; menu offers Change Password and Logout; no
// 'Change Requester'". AppShell.test.tsx covers only C-07 (role
// navigation) and explicitly defers this component — no test anywhere
// renders UserBadge directly, so this file mounts it on its own, the same
// way ChangePassword.test.tsx and AppShell.test.tsx seed AuthContext
// before mounting the component under test.
//
// The "no Change Requester" assertion is the Lab 3-specific regression
// this row exists to guard: issue #70 deletes Lab 2's Development
// Requester selector (RequesterBadge/RequesterContext/X-Requester-Id)
// entirely, and UserBadge is its replacement (ui-spec.md §4.1, and
// UserBadge.tsx's own header comment).

const API_BASE_URL = "http://localhost:3000";
const LOGOUT_URL = `${API_BASE_URL}/api/auth/logout`;

const STAFF_USER: AuthUser = {
  id: 7,
  name: "Priya Natarajan",
  email: "priya.natarajan@example.edu",
  role: "IT_STAFF",
  mustChangePassword: false,
};

/** Seeds AuthContext with a known user before UserBadge mounts. */
function AuthBootstrap({ user, children }: { user: AuthUser; children: ReactNode }) {
  const { user: current, setUser } = useAuth();
  useEffect(() => {
    if (!current) setUser(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!current) return null;
  return <>{children}</>;
}

function renderBadge(user: AuthUser = STAFF_USER) {
  // AuthBootstrap wraps only the /tickets route's element (not the whole
  // router) — logging out clears AuthContext's user, which would
  // otherwise unmount AuthBootstrap's children (it renders null once
  // `current` is falsy again) and tear down the MemoryRouter mid-
  // navigation before the Logout test below can observe the /login
  // route. Mirrors ChangePassword.test.tsx's renderForced().
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/tickets"]}>
        <Routes>
          <Route
            path="/tickets"
            element={
              <AuthBootstrap user={user}>
                <UserBadge />
              </AuthBootstrap>
            }
          />
          <Route path="/change-password" element={<h1>Change password route</h1>} />
          <Route path="/login" element={<h1>Login route</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("C-08 user badge (ui-spec.md §4.1)", () => {
  it("shows the authenticated user's name and a RoleBadge", async () => {
    renderBadge();
    const trigger = await screen.findByRole("button", { name: /priya natarajan/i });

    expect(within(trigger).getByText("Priya Natarajan")).toBeInTheDocument();
    // RoleBadge renders the role's display label, not the raw enum value.
    expect(within(trigger).getByText("IT Staff")).toBeInTheDocument();
  });

  it("menu is closed until the trigger is clicked, then offers exactly Change Password and Logout", async () => {
    renderBadge();
    const trigger = await screen.findByRole("button", { name: /priya natarajan/i });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Change Password", "Logout"]);
  });

  it("has no 'Change Requester' affordance anywhere (Lab 2's Dev Requester selector, deleted in #70)", async () => {
    renderBadge();
    const trigger = await screen.findByRole("button", { name: /priya natarajan/i });
    fireEvent.click(trigger);

    expect(screen.queryByRole("menuitem", { name: /change requester/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/change requester/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("Change Password menu item navigates to /change-password and closes the menu", async () => {
    renderBadge();
    const trigger = await screen.findByRole("button", { name: /priya natarajan/i });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("menuitem", { name: "Change Password" }));

    expect(await screen.findByRole("heading", { name: "Change password route" })).toBeInTheDocument();
  });

  it("Logout menu item calls POST /api/auth/logout and redirects to /login", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderBadge();
    const trigger = await screen.findByRole("button", { name: /priya natarajan/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Logout" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(LOGOUT_URL, expect.objectContaining({ method: "POST" })),
    );
    expect(await screen.findByRole("heading", { name: "Login route" })).toBeInTheDocument();
  });
});
