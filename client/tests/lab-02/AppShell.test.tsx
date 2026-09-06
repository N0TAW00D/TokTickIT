import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "../../src/shell/AppShell.tsx";
import { RequesterSelectionScreen } from "../../src/screens/RequesterSelectionScreen.tsx";
import {
  REQUESTER_STORAGE_KEY,
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";

const API_BASE_URL = "http://localhost:3000";
const REQUESTERS_URL = `${API_BASE_URL}/api/requesters`;

const ACTIVE_REQUESTERS = [
  { id: 1, name: "Jennifer Anderson", email: "jennifer.anderson@example.edu" },
  { id: 2, name: "Michael Brown", email: "michael.brown@example.edu" },
];

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockRequestersFetch() {
  const fetchMock = vi.fn((input: string) => {
    if (input === REQUESTERS_URL) return jsonResponse(200, ACTIVE_REQUESTERS);
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Test-only stand-in for what the real route guard (added in a later
 * commit, see src/routes/RequireRequester.tsx) does at app start: seed the
 * context with an already-known-valid Requester via the same public
 * `selectRequester` API a real Continue click uses. This lets AppShell /
 * RequesterBadge be exercised without depending on the guard or on
 * client routing, neither of which exist yet at this point in the build.
 */
function Bootstrap({
  id,
  name,
  children,
}: {
  id: number;
  name: string;
  children: ReactNode;
}) {
  const { requesterName, selectRequester } = useRequester();

  useEffect(() => {
    if (requesterName === null) {
      selectRequester({ id, name });
    }
    // Seed once on mount; the id/name passed in are stable per test.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (requesterName === null) {
    return null;
  }

  return <>{children}</>;
}

function renderHarness() {
  return render(
    <RequesterProvider>
      <Bootstrap id={1} name="Jennifer Anderson">
        <MemoryRouter initialEntries={["/tickets"]}>
          <Routes>
            <Route
              path="/select-requester"
              element={<RequesterSelectionScreen />}
            />
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
      </Bootstrap>
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

describe("C-07 app shell", () => {
  it('shows the current Requester name and a "Change Requester" action, and marks the active nav link with aria-current="page"', () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: /jennifer anderson/i }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Change Requester" }),
    ).toBeInTheDocument();
  });

  it('"Change Requester" routes to /select-requester', async () => {
    mockRequestersFetch();
    renderHarness();

    fireEvent.click(
      screen.getByRole("button", { name: /jennifer anderson/i }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Change Requester" }));

    expect(
      await screen.findByRole("heading", {
        name: "Select Development Requester",
      }),
    ).toBeInTheDocument();
  });
});

describe("C-08 requester switch", () => {
  // AC-09/BR-11 also require My Tickets to reload its data for the new
  // Requester. My Tickets is real now (MyTicketsScreen, ui-spec.md §9) and
  // that reload half is covered where the real screen lives — see the
  // "AC-09 My Tickets resets on Requester switch" describe block in
  // MyTickets.test.tsx, which drives a non-default search/filter/sort
  // through an actual Change Requester → Continue round trip and asserts
  // the resulting request is scoped to the new Requester with everything
  // back at its default. This test still only covers the part that lives
  // in AppShell/RequesterContext regardless of which screen is mounted:
  // switching Requesters replaces the requester-scoped context (id + name)
  // rather than merging with the old one, and the old Requester's identity
  // is fully gone afterward.
  it("replaces the requester-scoped context id/name when a different requester is chosen", async () => {
    mockRequestersFetch();
    renderHarness();

    expect(screen.getByText("Jennifer Anderson")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /jennifer anderson/i }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Change Requester" }));

    const select = await screen.findByLabelText(/development requester/i);
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem(REQUESTER_STORAGE_KEY)).toBe("2");
    });

    expect(
      await screen.findByRole("heading", { name: "My Tickets" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Michael Brown")).toBeInTheDocument();
    expect(screen.queryByText("Jennifer Anderson")).not.toBeInTheDocument();
  });
});
