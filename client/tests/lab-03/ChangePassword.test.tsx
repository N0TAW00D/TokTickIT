import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { ChangePasswordScreen } from "../../src/screens/ChangePasswordScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import { RequesterProvider } from "../../src/requester/RequesterContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";

// Covers docs/lab-03/ui-spec.md §6 (Change Password screen) and
// tests.md's client component rows for /change-password: forced vs
// voluntary mode, validation messages, and success.

const API_BASE_URL = "http://localhost:3000";
const CHANGE_PASSWORD_URL = `${API_BASE_URL}/api/auth/change-password`;

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockChangePasswordFetch(handler: (init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === CHANGE_PASSWORD_URL) return handler(init);
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Seeds AuthContext with a known user before the screen under test mounts — the same pattern client/tests/lab-02/AppShell.test.tsx uses for RequesterContext. */
function AuthBootstrap({ user, children }: { user: AuthUser; children: ReactNode }) {
  const { user: current, setUser } = useAuth();

  useEffect(() => {
    if (!current) setUser(user);
    // Seed once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!current) return null;
  return <>{children}</>;
}

const FORCED_USER: AuthUser = {
  id: 1,
  name: "New Hire",
  email: "new.hire@example.edu",
  role: "REQUESTER",
  mustChangePassword: true,
};

const VOLUNTARY_USER: AuthUser = {
  id: 2,
  name: "Established User",
  email: "established@example.edu",
  role: "IT_STAFF",
  mustChangePassword: false,
};

function renderForced() {
  return render(
    <AuthProvider>
      <AuthBootstrap user={FORCED_USER}>
        <MemoryRouter initialEntries={["/change-password"]}>
          <Routes>
            <Route path="/change-password" element={<ChangePasswordScreen />} />
            <Route path="/" element={<h1>Landing</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

function renderVoluntary() {
  return render(
    <AuthProvider>
      <AuthBootstrap user={VOLUNTARY_USER}>
        {/* AppShell (rendered in voluntary mode) always mounts
            RequesterBadge, which needs RequesterProvider regardless of
            auth — a pre-existing Lab 2 requirement, not something this
            test introduces. */}
        <RequesterProvider>
          <MemoryRouter initialEntries={["/tickets", "/change-password"]}>
            <Routes>
              <Route path="/change-password" element={<ChangePasswordScreen />} />
              <Route path="/tickets" element={<h1>Previous route</h1>} />
              <Route path="/" element={<h1>Landing</h1>} />
            </Routes>
          </MemoryRouter>
        </RequesterProvider>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("forced mode (mustChangePassword: true)", () => {
  it("shows the explanatory banner and hides Current password entirely", async () => {
    mockChangePasswordFetch(() => jsonResponse(204, {}));
    renderForced();

    expect(await screen.findByText(/choose a new password before continuing/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
  });

  it("has no Cancel action — non-dismissible", async () => {
    renderForced();
    await screen.findByText(/choose a new password before continuing/i);

    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("submits {newPassword, confirmPassword} only, with no currentPassword key", async () => {
    const fetchMock = mockChangePasswordFetch(() => jsonResponse(204, {}));
    renderForced();
    await screen.findByLabelText(/^new password/i);

    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "BrandNewPassword1" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "BrandNewPassword1" } });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ newPassword: "BrandNewPassword1", confirmPassword: "BrandNewPassword1" });
    expect(body).not.toHaveProperty("currentPassword");
  });
});

describe("voluntary mode (mustChangePassword: false)", () => {
  it("shows Current password, required", async () => {
    renderVoluntary();
    const field = await screen.findByLabelText(/current password/i);
    expect(field).toBeRequired();
  });

  it("Cancel is present and returns to the previous route", async () => {
    renderVoluntary();
    await screen.findByLabelText(/current password/i);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(await screen.findByRole("heading", { name: "Previous route" })).toBeInTheDocument();
  });

  it("rejects a submit with a blank current password", async () => {
    const fetchMock = mockChangePasswordFetch(() => jsonResponse(204, {}));
    renderVoluntary();
    await screen.findByLabelText(/current password/i);

    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "BrandNewPassword1" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "BrandNewPassword1" } });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));

    expect(screen.getByText(/current password is required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 WRONG_PASSWORD surfaces as a Current password field error", async () => {
    mockChangePasswordFetch(() =>
      jsonResponse(403, { error: "WRONG_PASSWORD", message: "Current password is incorrect." }),
    );
    renderVoluntary();
    await screen.findByLabelText(/current password/i);

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: "wrongpassword" } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "BrandNewPassword1" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "BrandNewPassword1" } });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));

    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
  });
});

describe("validation messages (both modes)", () => {
  it("too-short new password gets a length message", async () => {
    renderForced();
    await screen.findByLabelText(/^new password/i);

    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "short1" } });
    fireEvent.blur(screen.getByLabelText(/^new password/i));

    expect(screen.getByText(/must be between 8 and 128 characters/i)).toBeInTheDocument();
  });

  it("mismatched confirmation gets a mismatch message", async () => {
    renderForced();
    await screen.findByLabelText(/^new password/i);

    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "BrandNewPassword1" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "SomethingElse1" } });
    fireEvent.blur(screen.getByLabelText(/confirm new password/i));

    expect(screen.getByText(/must match new password/i)).toBeInTheDocument();
  });

  it("a same-as-current 400 from the server maps onto the New password field", async () => {
    mockChangePasswordFetch(() =>
      jsonResponse(400, {
        error: "VALIDATION_FAILED",
        message: "One or more fields are invalid.",
        fields: [{ field: "newPassword", message: "New password must be different from your current password." }],
      }),
    );
    renderForced();
    await screen.findByLabelText(/^new password/i);

    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "SamePassword12" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "SamePassword12" } });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));

    expect(await screen.findByText(/must be different from your current password/i)).toBeInTheDocument();
  });
});

describe("success", () => {
  // Real timers, not fake — RTL's findBy*/waitFor poll via setTimeout
  // internally, which fake timers would also intercept and then need
  // manual advancing to unstick; simpler and just as fast at 1.2s to wait
  // for real (SUCCESS_REDIRECT_DELAY_MS in the screen itself).
  it(
    "shows a success state and redirects afterward",
    async () => {
      mockChangePasswordFetch(() => jsonResponse(204, {}));
      renderForced();
      await screen.findByLabelText(/^new password/i);

      fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "BrandNewPassword1" } });
      fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "BrandNewPassword1" } });
      fireEvent.click(screen.getByRole("button", { name: /save password/i }));

      expect(await screen.findByText(/password changed/i)).toBeInTheDocument();

      expect(
        await screen.findByRole("heading", { name: "Landing" }, { timeout: 3000 }),
      ).toBeInTheDocument();
    },
    8000,
  );
});
