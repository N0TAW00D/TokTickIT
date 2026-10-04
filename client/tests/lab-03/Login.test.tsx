import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LoginScreen } from "../../src/screens/LoginScreen.tsx";
import { AuthProvider } from "../../src/auth/AuthContext.tsx";

// Covers docs/lab-03/ui-spec.md §5 (Login screen) and tests.md's client
// component rows for /login: field validation, busy state, and the single
// generic failure callout shared by wrong-credentials and rate-limited
// (BR-08, BR-38) — matches server/tests/lab-03/auth.api.test.ts's API-level
// coverage of the same endpoint from the other side.

const API_BASE_URL = "http://localhost:3000";
const LOGIN_URL = `${API_BASE_URL}/api/auth/login`;

const GENERIC_FAILURE_TEXT =
  "We couldn't sign you in. Check your email and password and try again.";

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockLoginFetch(handler: (init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === LOGIN_URL) return handler(init);
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderScreen() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/change-password" element={<h1>Change password</h1>} />
          <Route path="/" element={<h1>Landing</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Login screen rendering", () => {
  it("renders email + password fields and a Sign in button", () => {
    mockLoginFetch(() => jsonResponse(200, {}));
    renderScreen();

    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("field validation", () => {
  beforeEach(() => {
    mockLoginFetch(() => jsonResponse(200, {}));
  });

  it("rejects an empty email on submit and never calls the API", () => {
    const fetchMock = mockLoginFetch(() => jsonResponse(200, {}));
    renderScreen();

    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "somepassword" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "not-an-email" } });
    fireEvent.blur(screen.getByLabelText(/^email/i));

    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
  });

  it("rejects an empty password on submit", () => {
    const fetchMock = mockLoginFetch(() => jsonResponse(200, {}));
    renderScreen();

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "user@example.edu" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("busy state", () => {
  it("disables the submit button, shows the busy label, and makes inputs read-only while the request is in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    mockLoginFetch(() => pending);
    renderScreen();

    fillAndSubmit("user@example.edu", "correctpassword");

    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(screen.getByLabelText(/^email/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^password/i)).toHaveAttribute("readonly");
    expect(screen.getByRole("status")).toHaveTextContent(/signing in/i);

    resolveFetch(
      await jsonResponse(200, {
        id: 1,
        name: "Test User",
        email: "user@example.edu",
        role: "REQUESTER",
        mustChangePassword: false,
      }),
    );
    await screen.findByRole("heading", { name: "Landing" });
  });
});

describe("failure callout (BR-08, BR-38)", () => {
  it("shows the generic failure message for a 401 INVALID_CREDENTIALS", async () => {
    mockLoginFetch(() =>
      jsonResponse(401, {
        error: "INVALID_CREDENTIALS",
        message: GENERIC_FAILURE_TEXT,
      }),
    );
    renderScreen();

    fillAndSubmit("user@example.edu", "wrongpassword");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(GENERIC_FAILURE_TEXT);
  });

  it("shows the SAME generic message, not a different one, for a 429 RATE_LIMITED", async () => {
    mockLoginFetch(() =>
      jsonResponse(429, {
        error: "RATE_LIMITED",
        message: GENERIC_FAILURE_TEXT,
      }),
    );
    renderScreen();

    fillAndSubmit("user@example.edu", "wrongpassword");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(GENERIC_FAILURE_TEXT);
    // Never leaks which case it was — no mention of "rate" or "attempt".
    expect(alert.textContent?.toLowerCase()).not.toMatch(/rate|attempt|locked/);
  });
});

describe("success", () => {
  it("navigates to the landing route on a normal successful login", async () => {
    mockLoginFetch(() =>
      jsonResponse(200, {
        id: 7,
        name: "Suda Chaiyaporn",
        email: "suda.c@example.edu",
        role: "IT_STAFF",
        mustChangePassword: false,
      }),
    );
    renderScreen();

    fillAndSubmit("suda.c@example.edu", "correctpassword");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Landing" })).toBeInTheDocument();
    });
  });

  it("navigates to /change-password when the account must change its password", async () => {
    mockLoginFetch(() =>
      jsonResponse(200, {
        id: 3,
        name: "New Hire",
        email: "new.hire@example.edu",
        role: "REQUESTER",
        mustChangePassword: true,
      }),
    );
    renderScreen();

    fillAndSubmit("new.hire@example.edu", "temporarypassword1");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Change password" })).toBeInTheDocument();
    });
  });

  it("sends credentials: 'include' so the session cookie round-trips", async () => {
    const fetchMock = mockLoginFetch(() =>
      jsonResponse(200, {
        id: 1,
        name: "Test User",
        email: "user@example.edu",
        role: "REQUESTER",
        mustChangePassword: false,
      }),
    );
    renderScreen();

    fillAndSubmit("user@example.edu", "correctpassword");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });
});
