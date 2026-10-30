import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { MyTicketsScreen } from "../../src/screens/MyTicketsScreen.tsx";
import { UserManagementScreen } from "../../src/screens/UserManagementScreen.tsx";
import { StaffTicketQueueScreen } from "../../src/screens/StaffTicketQueueScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser, Role } from "../../src/auth/api.ts";
import { API, jsonResponse } from "./dashboardFixtures.ts";

// api-spec.md §6 / ui-spec.md §2: the lists read drill-down parameters
// (scope, status, owner, itPriority, myActions, followUp, sort, order|direction)
// from the URL, send them to the API, show the active drill-down as a
// clearable chip row, and keep the URL and the filter UI in step.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function AuthBootstrap({ user, children }: { user: AuthUser; children: ReactNode }) {
  const { user: current, setUser } = useAuth();
  useEffect(() => {
    if (!current) setUser(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!current) return null;
  return <>{children}</>;
}

const EMPTY_TICKETS = {
  items: [],
  meta: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0, sort: "createdAt", order: "desc" },
};
const EMPTY_QUEUE = { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 };

function stubApi() {
  const fetchMock = vi.fn((input: string) => {
    if (input.startsWith(`${API}/api/staff/tickets`)) return jsonResponse(200, EMPTY_QUEUE);
    if (input.startsWith(`${API}/api/tickets`)) return jsonResponse(200, EMPTY_TICKETS);
    return jsonResponse(200, []);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function listCalls(fetchMock: ReturnType<typeof stubApi>, prefix: string): URLSearchParams[] {
  return fetchMock.mock.calls
    .map((call) => call[0] as string)
    .filter((url) => url.startsWith(prefix))
    .map((url) => new URL(url).searchParams);
}

function renderMyTickets(url: string) {
  stubMatchMedia(true);
  const fetchMock = stubApi();
  render(
    <MemoryRouter initialEntries={[url]}>
      <Link to="/tickets?scope=recent&sort=updatedAt&order=desc">go-recent</Link>
      <Routes>
        <Route path="/tickets" element={<MyTicketsScreen />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
  return fetchMock;
}

function renderQueue(url: string, role: Role = "IT_STAFF") {
  stubMatchMedia(true);
  const fetchMock = stubApi();
  const user: AuthUser = { id: 7, name: "Priya", email: "p@e.edu", role, mustChangePassword: false };
  render(
    <AuthProvider>
      <AuthBootstrap user={user}>
        <MemoryRouter initialEntries={[url]}>
          <Link to="/staff/tickets?itPriority=HIGH&scope=open">go-urgent</Link>
          <Routes>
            <Route path="/staff/tickets" element={<StaffTicketQueueScreen />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
  return fetchMock;
}

const TICKETS = `${API}/api/tickets`;
const QUEUE = `${API}/api/staff/tickets`;

describe("My Tickets reads drill-down parameters from the URL (api-spec.md §6.1)", () => {
  it.each([
    ["?scope=open", { scope: "open" }],
    ["?status=WAITING_FOR_REQUESTER", { status: "WAITING_FOR_REQUESTER" }],
    ["?scope=recent&sort=updatedAt&order=desc", { scope: "recent", sort: "updatedAt", order: "desc" }],
    ["?scope=recently-resolved", { scope: "recently-resolved" }],
  ])("%s is sent to GET /api/tickets on the first request", async (search, expected) => {
    const fetchMock = renderMyTickets(`/tickets${search}`);
    await screen.findByText("No tickets match your search or filters.");
    const first = listCalls(fetchMock, TICKETS)[0];
    for (const [key, value] of Object.entries(expected)) expect(first.get(key)).toBe(value);
    // Nothing is requested before the URL is applied.
    expect(listCalls(fetchMock, TICKETS)).toHaveLength(1);
  });

  it("shows the active scope as a chip, the status in the Status select, and an empty drill-down as no-results", async () => {
    renderMyTickets("/tickets?scope=open&status=WAITING_FOR_REQUESTER");
    await screen.findByText("No tickets match your search or filters.");
    expect(screen.getByText("Open tickets")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("WAITING_FOR_REQUESTER");
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  it("offers all eight statuses in the Status filter (api-spec.md §6.1)", async () => {
    renderMyTickets("/tickets?scope=open");
    await screen.findByText("No tickets match your search or filters.");
    const options = within(screen.getByLabelText("Status")).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual([
      "",
      "NEW",
      "OPEN",
      "IN_PROGRESS",
      "WAITING_FOR_REQUESTER",
      "RESOLVED",
      "CLOSED",
      "REOPENED",
      "CANCELLED",
    ]);
  });

  it("ignores unknown scope and status values rather than sending them", async () => {
    const fetchMock = renderMyTickets("/tickets?scope=bogus&status=BOGUS");
    await waitFor(() => expect(listCalls(fetchMock, TICKETS).length).toBeGreaterThan(0));
    const first = listCalls(fetchMock, TICKETS)[0];
    expect(first.has("scope")).toBe(false);
    expect(first.has("status")).toBe(false);
  });

  it("Clear filters drops the drill-down from the request, the chip and the URL", async () => {
    const fetchMock = renderMyTickets("/tickets?scope=open");
    await screen.findByText("No tickets match your search or filters.");
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await waitFor(() => expect(listCalls(fetchMock, TICKETS).length).toBe(2));
    expect(listCalls(fetchMock, TICKETS)[1].has("scope")).toBe(false);
    expect(screen.queryByText("Open tickets")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/tickets$/);
  });

  it("changing a filter keeps the URL in step so Back/reload restores it", async () => {
    renderMyTickets("/tickets?scope=open");
    await screen.findByText("No tickets match your search or filters.");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "OPEN" } });
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/tickets?scope=open&status=OPEN"),
    );
  });

  it("a navigation to a different drill-down on the same screen re-applies it", async () => {
    const fetchMock = renderMyTickets("/tickets?scope=open");
    await screen.findByText("No tickets match your search or filters.");
    fireEvent.click(screen.getByRole("link", { name: "go-recent" }));
    await waitFor(() => {
      const calls = listCalls(fetchMock, TICKETS);
      expect(calls[calls.length - 1].get("scope")).toBe("recent");
    });
    const last = listCalls(fetchMock, TICKETS).at(-1)!;
    expect(last.get("sort")).toBe("updatedAt");
    expect(last.get("order")).toBe("desc");
    expect(screen.getByText("Updated in the last 7 days")).toBeInTheDocument();
  });
});

describe("Staff queue reads drill-down parameters from the URL (api-spec.md §6.2)", () => {
  it.each([
    ["?owner=unassigned&scope=open", { owner: "unassigned", scope: "open" }],
    ["?owner=me&scope=open", { owner: "me", scope: "open" }],
    ["?status=CANCELLED", { status: "CANCELLED" }],
    ["?itPriority=HIGH&scope=open", { itPriority: "HIGH", scope: "open" }],
    ["?myActions=true&scope=open", { myActions: "true", scope: "open" }],
    ["?followUp=true&scope=open", { followUp: "true", scope: "open" }],
    ["?scope=recent&sort=updatedAt&direction=desc", { scope: "recent", sort: "updatedAt", direction: "desc" }],
  ])("%s is sent to GET /api/staff/tickets on the first request", async (search, expected) => {
    const fetchMock = renderQueue(`/staff/tickets${search}`);
    await screen.findByText("No tickets match these filters");
    const first = listCalls(fetchMock, QUEUE)[0];
    for (const [key, value] of Object.entries(expected)) expect(first.get(key)).toBe(value);
    expect(listCalls(fetchMock, QUEUE)).toHaveLength(1);
  });

  it("an Administrator can read the queue with the same parameters", async () => {
    const fetchMock = renderQueue("/staff/tickets?followUp=true&scope=open", "ADMINISTRATOR");
    await screen.findByText("No tickets match these filters");
    expect(listCalls(fetchMock, QUEUE)[0].get("followUp")).toBe("true");
  });

  it("shows myActions, followUp and scope chips, and reflects status/priority/owner in their selects", async () => {
    renderQueue("/staff/tickets?myActions=true&followUp=true&scope=open&itPriority=HIGH&status=OPEN&owner=me");
    await screen.findByText("No tickets match these filters");
    expect(screen.getByText("My open actions")).toBeInTheDocument();
    expect(screen.getByText("Follow-ups required")).toBeInTheDocument();
    expect(screen.getByText("Open tickets")).toBeInTheDocument();
    expect(screen.getByLabelText("IT Priority")).toHaveValue("HIGH");
    expect(screen.getByLabelText("Status")).toHaveValue("OPEN");
    expect(screen.getByLabelText("Owner")).toHaveValue("me");
  });

  it("ignores myActions=false, an unknown scope and a bogus status", async () => {
    const fetchMock = renderQueue("/staff/tickets?myActions=false&scope=nope&status=BOGUS");
    await waitFor(() => expect(listCalls(fetchMock, QUEUE).length).toBeGreaterThan(0));
    const first = listCalls(fetchMock, QUEUE)[0];
    expect(first.has("myActions")).toBe(false);
    expect(first.has("scope")).toBe(false);
    expect(first.has("status")).toBe(false);
  });

  it("removing one chip refetches without it and leaves the others", async () => {
    const fetchMock = renderQueue("/staff/tickets?myActions=true&scope=open");
    await screen.findByText("No tickets match these filters");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: My open actions" }));
    await waitFor(() => expect(listCalls(fetchMock, QUEUE).length).toBe(2));
    const second = listCalls(fetchMock, QUEUE)[1];
    expect(second.has("myActions")).toBe(false);
    expect(second.get("scope")).toBe("open");
    expect(screen.getByTestId("location")).toHaveTextContent("/staff/tickets?scope=open");
  });

  it("Clear filters removes every drill-down from the request, chips and URL", async () => {
    const fetchMock = renderQueue("/staff/tickets?followUp=true&scope=open&owner=me");
    await screen.findByText("No tickets match these filters");
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await waitFor(() => expect(listCalls(fetchMock, QUEUE).length).toBe(2));
    const second = listCalls(fetchMock, QUEUE)[1];
    for (const key of ["followUp", "scope", "owner"]) expect(second.has(key)).toBe(false);
    expect(screen.queryByText("Follow-ups required")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/staff\/tickets$/);
  });

  it("a navigation to another drill-down on the same screen re-applies it", async () => {
    const fetchMock = renderQueue("/staff/tickets?followUp=true&scope=open");
    await screen.findByText("No tickets match these filters");
    fireEvent.click(screen.getByRole("link", { name: "go-urgent" }));
    await waitFor(() => {
      const calls = listCalls(fetchMock, QUEUE);
      expect(calls[calls.length - 1].get("itPriority")).toBe("HIGH");
    });
    const last = listCalls(fetchMock, QUEUE).at(-1)!;
    expect(last.has("followUp")).toBe(false);
    expect(last.get("scope")).toBe("open");
  });

  it("changing the Status filter keeps the URL in step", async () => {
    renderQueue("/staff/tickets?scope=open");
    await screen.findByText("No tickets match these filters");
    fireEvent.change(within(document.body).getByLabelText("Status"), { target: { value: "RESOLVED" } });
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/staff/tickets?scope=open&status=RESOLVED"),
    );
  });
});

describe("User Management reads ?role= from the URL (Users strip, api-spec.md §5)", () => {
  it.each([
    ["?role=IT_STAFF", "IT_STAFF"],
    ["?role=BOGUS", null],
  ])("%s", async (search, expected) => {
    stubMatchMedia(true);
    const fetchMock = vi.fn(() => jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchMock);
    const user: AuthUser = { id: 1, name: "A", email: "a@e.edu", role: "ADMINISTRATOR", mustChangePassword: false };
    render(
      <AuthProvider>
        <AuthBootstrap user={user}>
          <MemoryRouter initialEntries={[`/admin/users${search}`]}>
            <Routes>
              <Route path="/admin/users" element={<UserManagementScreen />} />
            </Routes>
          </MemoryRouter>
        </AuthBootstrap>
      </AuthProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const first = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(first.searchParams.get("role")).toBe(expected);
  });
});

describe("User Management keeps the role filter in step with the URL (ui-spec.md §2)", () => {
  function renderUsers(url: string) {
    stubMatchMedia(true);
    const fetchMock = vi.fn(() => jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchMock);
    const user: AuthUser = { id: 1, name: "A", email: "a@e.edu", role: "ADMINISTRATOR", mustChangePassword: false };
    function Nav() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate("/dashboard")}>
            go dashboard
          </button>
          <button type="button" onClick={() => navigate(-1)}>
            history back
          </button>
        </>
      );
    }
    render(
      <AuthProvider>
        <AuthBootstrap user={user}>
          <MemoryRouter initialEntries={[url]}>
            <LocationProbe />
            <Nav />
            <Routes>
              <Route path="/admin/users" element={<UserManagementScreen />} />
              <Route path="/dashboard" element={<p>dashboard page</p>} />
            </Routes>
          </MemoryRouter>
        </AuthBootstrap>
      </AuthProvider>,
    );
    return fetchMock;
  }

  function lastRole(fetchMock: ReturnType<typeof vi.fn>): string | null {
    const calls = fetchMock.mock.calls as unknown as [string][];
    return new URL(calls[calls.length - 1][0]).searchParams.get("role");
  }

  it("C-33: the chosen role is in the URL, so returning with Back restores it in the select and the request", async () => {
    const fetchMock = renderUsers("/admin/users?role=IT_STAFF");
    const select = (await screen.findByLabelText("Role")) as HTMLSelectElement;
    expect(select.value).toBe("IT_STAFF");

    fireEvent.change(select, { target: { value: "ADMINISTRATOR" } });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/admin/users?role=ADMINISTRATOR"));
    await waitFor(() => expect(lastRole(fetchMock)).toBe("ADMINISTRATOR"));

    fireEvent.click(screen.getByRole("button", { name: "go dashboard" }));
    await screen.findByText("dashboard page");
    expect(screen.getByTestId("location").textContent).toBe("/dashboard");

    fireEvent.click(screen.getByRole("button", { name: "history back" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/admin/users?role=ADMINISTRATOR"));
    await waitFor(() => expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("ADMINISTRATOR"));
    await waitFor(() => expect(lastRole(fetchMock)).toBe("ADMINISTRATOR"));

    // Choosing "all" removes the parameter.
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "" } });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/admin/users"));
    await waitFor(() => expect(lastRole(fetchMock)).toBeNull());
  });
});
