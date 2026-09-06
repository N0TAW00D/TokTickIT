import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "../../src/App.tsx";
import { RequesterSelectionScreen } from "../../src/screens/RequesterSelectionScreen.tsx";
import {
  REQUESTER_STORAGE_KEY,
  RequesterProvider,
} from "../../src/requester/RequesterContext.tsx";

// C-01 and C-06 exercise the route guard (client/src/routes/RequireRequester.tsx)
// so they render the full App under a MemoryRouter. The rest of this file
// covers the Selection screen's own behavior in isolation (loading / error /
// empty / success), independent of routing/the guard.

const API_BASE_URL = "http://localhost:3000";
const REQUESTERS_URL = `${API_BASE_URL}/api/requesters`;

const ACTIVE_REQUESTERS = [
  { id: 4, name: "David Lee", email: "david.lee@example.edu" },
  { id: 1, name: "Jennifer Anderson", email: "jennifer.anderson@example.edu" },
  { id: 2, name: "Michael Brown", email: "michael.brown@example.edu" },
  { id: 3, name: "Sarah Johnson", email: "sarah.johnson@example.edu" },
];

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockRequestersFetch(handler: () => Promise<Response>) {
  const fetchMock = vi.fn((input: string) => {
    if (input === REQUESTERS_URL) return handler();
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderScreen() {
  return render(
    <RequesterProvider>
      <MemoryRouter initialEntries={["/select-requester"]}>
        <Routes>
          <Route
            path="/select-requester"
            element={<RequesterSelectionScreen />}
          />
          <Route path="/tickets" element={<h1>My Tickets</h1>} />
        </Routes>
      </MemoryRouter>
    </RequesterProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("C-01 route guard", () => {
  it("renders the Requester Selection screen when visiting /tickets with no stored requester", async () => {
    mockRequestersFetch(() => jsonResponse(200, ACTIVE_REQUESTERS));

    render(
      <MemoryRouter initialEntries={["/tickets"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Select Development Requester",
      }),
    ).toBeInTheDocument();
  });
});

describe("C-06 stale stored requester", () => {
  it("clears an invalid stored id and shows the unavailable notice on the selection screen", async () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, "999");
    mockRequestersFetch(() => jsonResponse(200, ACTIVE_REQUESTERS));

    render(
      <MemoryRouter initialEntries={["/tickets"]}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", {
      name: "Select Development Requester",
    });

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(
      "Your previous development requester is no longer available. Please choose again.",
    );
    expect(window.localStorage.getItem(REQUESTER_STORAGE_KEY)).toBeNull();
  });
});

describe("C-02 selection loading", () => {
  it('shows a role="status" loading indicator and disables Continue while requesters are pending', () => {
    mockRequestersFetch(() => new Promise(() => {})); // never resolves

    renderScreen();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});

describe("C-03 selection API failure", () => {
  it('shows a role="alert" with Retry and renders no select', async () => {
    mockRequestersFetch(() => Promise.reject(new Error("network down")));

    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});

describe("C-04 selection empty", () => {
  it("shows a distinct empty-state message and keeps Continue disabled", async () => {
    mockRequestersFetch(() => jsonResponse(200, []));

    renderScreen();

    expect(
      await screen.findByText(/no active development requesters/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("C-05 selection success", () => {
  it("stores the chosen id in localStorage and navigates to /tickets", async () => {
    mockRequestersFetch(() => jsonResponse(200, ACTIVE_REQUESTERS));

    renderScreen();

    const select = await screen.findByLabelText(/development requester/i);

    // Nothing pre-selected: Continue starts disabled (ui-spec.md §6).
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    fireEvent.change(select, { target: { value: "2" } });

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(window.localStorage.getItem(REQUESTER_STORAGE_KEY)).toBe("2");
    });
    expect(
      await screen.findByRole("heading", { name: "My Tickets" }),
    ).toBeInTheDocument();
  });
});
