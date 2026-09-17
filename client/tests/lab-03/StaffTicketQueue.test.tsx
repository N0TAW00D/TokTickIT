import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { StaffTicketQueueScreen } from "../../src/screens/StaffTicketQueueScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";
import { formatDateTime } from "../../src/tickets/formatDateTime.ts";

// Covers docs/lab-03/tests.md C-10 (unassigned owner token), C-11 (queue
// states: loading/empty/no-results/failure — forbidden is RequireRole's own
// territory, see RequireRole.test.tsx), and C-12 (search/filter/sort query
// params). The screen calls `useAuth()` directly (not the optional variant),
// so every render here needs a real `AuthProvider` seeded with an IT_STAFF
// user first — same `AuthBootstrap` pattern as AppShell.test.tsx and
// RequireRole.test.tsx, adapted from `AuthUser`/`Role`.

const API_BASE_URL = "http://localhost:3000";
const STAFF_TICKETS_URL = `${API_BASE_URL}/api/staff/tickets`;
const CATEGORIES_URL = `${API_BASE_URL}/api/categories`;

const CATEGORIES = [
  { id: 4, name: "Network" },
  { id: 2, name: "Hardware" },
];

const TICKET_ASSIGNED = {
  id: 21,
  ticketNumber: "TKT-2026-000021",
  summary: "Printer not connecting to network",
  category: { id: 4, name: "Network" },
  requestedPriority: "MEDIUM",
  itPriority: "HIGH",
  status: "OPEN",
  owner: { id: 7, name: "Alex Rivera" },
  requesterResolvedAt: null,
  createdAt: "2026-09-01T02:08:00.000Z",
  updatedAt: "2026-09-05T09:30:00.000Z",
};

const TICKET_UNASSIGNED = {
  id: 22,
  ticketNumber: "TKT-2026-000022",
  summary: "Cannot access shared drive",
  category: { id: 2, name: "Hardware" },
  requestedPriority: "LOW",
  itPriority: "MEDIUM",
  status: "NEW",
  owner: null,
  requesterResolvedAt: null,
  createdAt: "2026-09-02T02:08:00.000Z",
  updatedAt: "2026-09-02T02:08:00.000Z",
};

const QUEUE_RESPONSE = {
  items: [TICKET_ASSIGNED, TICKET_UNASSIGNED],
  page: 1,
  pageSize: 20,
  totalItems: 2,
  totalPages: 1,
};

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

type StaffHandler = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function mockFetch(staffHandler?: StaffHandler) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.startsWith(STAFF_TICKETS_URL)) {
      return (staffHandler ?? (() => jsonResponse(200, QUEUE_RESPONSE)))(
        input,
        init,
      );
    }
    if (input.startsWith(CATEGORIES_URL)) {
      return jsonResponse(200, CATEGORIES);
    }
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Number of `/api/staff/tickets` calls `fetchMock` has recorded — excludes
 * the `/api/categories` call the Category filter also fires on mount. */
function queueCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([input]: [string]) =>
    input.startsWith(STAFF_TICKETS_URL),
  ).length;
}

/** The `[url, init]` args of the Nth (1-indexed) `/api/staff/tickets` call. */
function queueCall(
  fetchMock: ReturnType<typeof vi.fn>,
  n: number,
): [string, RequestInit | undefined] {
  const calls = fetchMock.mock.calls.filter(([input]: [string]) =>
    input.startsWith(STAFF_TICKETS_URL),
  ) as [string, RequestInit | undefined][];
  return calls[n - 1];
}

/** Same technique as MyTickets.test.tsx / AppShell.test.tsx / RequireRole.test.tsx: jsdom has no `matchMedia`, so this fixes it for one test's lifetime. */
function stubMatchMedia(matches: boolean) {
  const mediaQueryList = {
    matches,
    media: "",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mediaQueryList));
}

/** Seeds AuthContext with an IT Staff user before the screen mounts (AppShell.test.tsx / RequireRole.test.tsx's own pattern) — the screen calls `useAuth()` directly, so it must never mount without this. */
function AuthBootstrap({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const staffUser: AuthUser = {
    id: 9,
    name: "Jordan Lee",
    email: "jordan.lee@example.edu",
    role: "IT_STAFF",
    mustChangePassword: false,
  };
  useEffect(() => {
    if (!user) setUser(staffUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

function renderScreen() {
  return render(
    <AuthProvider>
      <AuthBootstrap>
        <MemoryRouter initialEntries={["/staff/tickets"]}>
          <Routes>
            <Route path="/staff/tickets" element={<StaffTicketQueueScreen />} />
            <Route path="/staff/tickets/:id" element={<h1>Ticket Detail</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

beforeEach(() => {
  stubMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("C-10/desktop table render", () => {
  it("renders the seven documented columns plus a hidden Actions header, with real ticket data including the Owner distinction", async () => {
    const fetchMock = mockFetch();
    renderScreen();

    const table = await screen.findByRole("table");
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "Ticket Number",
      "Summary",
      "Category",
      "IT Priority",
      "Status",
      "Owner",
      "Last Updated",
      "Actions",
    ]);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 data rows

    // Ticket number link.
    expect(
      screen.getByRole("link", { name: "TKT-2026-000021" }),
    ).toHaveAttribute("href", "/staff/tickets/21");

    // Summary, Category, IT Priority (prefixed, distinct from any Requested
    // Priority text), Status, Last Updated — scoped to the table since some
    // of these words also appear as filter <option> labels.
    expect(within(table).getByText("Printer not connecting to network")).toBeInTheDocument();
    expect(within(table).getByText("Network")).toBeInTheDocument();
    expect(within(table).getByText("IT: High")).toBeInTheDocument();
    expect(within(table).getByText("IT: Medium")).toBeInTheDocument();
    expect(within(table).getByText("Open")).toBeInTheDocument();
    expect(within(table).getByText("New")).toBeInTheDocument();
    expect(
      within(table).getByText(formatDateTime(TICKET_ASSIGNED.updatedAt)),
    ).toBeInTheDocument();

    // Owner: assigned shows the plain name with data-owner="assigned";
    // unassigned shows the distinct "Unassigned" badge with
    // data-owner="unassigned" (AC-32 / C-10).
    const assignedOwner = within(table).getByText("Alex Rivera");
    expect(assignedOwner.closest("[data-owner]")).toHaveAttribute(
      "data-owner",
      "assigned",
    );
    const unassignedLabel = within(table).getByText("Unassigned");
    expect(unassignedLabel.closest("[data-owner]")).toHaveAttribute(
      "data-owner",
      "unassigned",
    );

    // Explicit keyboard-reachable View affordance, distinct from the
    // ticket-number identity link (ui-spec.md §12).
    const viewLink = screen.getByRole("link", {
      name: /view ticket tkt-2026-000021/i,
    });
    expect(viewLink).toHaveAttribute("href", "/staff/tickets/21");
    fireEvent.click(viewLink);
    expect(
      await screen.findByRole("heading", { name: "Ticket Detail" }),
    ).toBeInTheDocument();

    // Session-cookie scoped, same convention as My Tickets/staff/api.ts.
    const [, init] = queueCall(fetchMock, 1) as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });
});

describe("Loading state (ui-spec.md §9)", () => {
  it("shows a role=status skeleton and no real table while the request is in flight", () => {
    mockFetch(() => new Promise(() => {}));
    renderScreen();

    expect(screen.getByRole("status")).toBeInTheDocument();
    // The skeleton's own <table> is aria-hidden, so it's excluded from the
    // accessibility tree entirely — this only passes once a REAL table
    // (which would not be aria-hidden) is absent too.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Empty state (\"The queue is empty\")", () => {
  it("shows EmptyState — not NoResultsState — and hides the controls bar when the queue holds zero tickets with no filters active", async () => {
    mockFetch(() =>
      jsonResponse(200, {
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
      }),
    );
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "The queue is empty" }),
    ).toBeInTheDocument();

    expect(
      screen.queryByText("No tickets match these filters"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).not.toBeInTheDocument();

    // Nothing to search/filter when the queue holds no tickets at all.
    expect(screen.queryByLabelText("Search")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sort")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("No-results state (\"No tickets match these filters\")", () => {
  it("shows NoResultsState with Clear filters when a filter matches nothing but the queue isn't empty overall; Clear filters resets and refetches", async () => {
    const fetchMock = mockFetch((input) => {
      const status = new URL(input).searchParams.get("status");
      if (status === "CLOSED") {
        return jsonResponse(200, {
          items: [],
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 0,
        });
      }
      return jsonResponse(200, QUEUE_RESPONSE);
    });
    renderScreen();

    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "CLOSED" },
    });

    const message = await screen.findByText("No tickets match these filters");
    expect(queueCallCount(fetchMock)).toBe(2);

    // Not the true-empty presentation.
    expect(
      screen.queryByText("The queue is empty"),
    ).not.toBeInTheDocument();

    // Filters stay visible/populated (scoped to the no-results block for
    // its own Clear filters button, since the header's own Clear filters
    // button is also visible right now for the same reason — the Status
    // filter is non-default).
    expect(screen.getByLabelText("Status")).toHaveValue("CLOSED");
    const noResultsRegion = message.parentElement as HTMLElement;
    const clearButton = within(noResultsRegion).getByRole("button", {
      name: /clear filters/i,
    });

    fireEvent.click(clearButton);
    await screen.findByRole("table");

    expect(queueCallCount(fetchMock)).toBe(3);
    expect(screen.getByLabelText("Status")).toHaveValue("");
    const params = new URL(queueCall(fetchMock, 3)[0]).searchParams;
    expect(params.has("status")).toBe(false);
    expect(params.get("page")).toBe("1");
  });
});

describe("Failure state (ErrorState + Retry)", () => {
  it("shows role=alert with the documented message when the fetch rejects; Retry re-fetches and recovers", async () => {
    const fetchMock = mockFetch(() =>
      Promise.reject(new Error("network down")),
    );
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not load the ticket queue. Please check your connection and try again.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /retry/i });
    fetchMock.mockImplementation((input: string) => {
      if (input.startsWith(STAFF_TICKETS_URL)) {
        return jsonResponse(200, QUEUE_RESPONSE);
      }
      if (input.startsWith(CATEGORIES_URL)) {
        return jsonResponse(200, CATEGORIES);
      }
      return jsonResponse(404, {});
    });

    fireEvent.click(retryButton);

    await screen.findByRole("table");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(queueCallCount(fetchMock)).toBe(2);
  });
});

describe("C-12 controls fire the documented query params", () => {
  it("debounces the search box 300ms, sending exactly one request carrying the final value", async () => {
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByRole("table");
    expect(queueCallCount(fetchMock)).toBe(1);

    vi.useFakeTimers();
    const searchInput = screen.getByLabelText("Search");
    fireEvent.change(searchInput, { target: { value: "v" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(searchInput, { target: { value: "vp" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(searchInput, { target: { value: "vpn" } });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(queueCallCount(fetchMock)).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(queueCallCount(fetchMock)).toBe(2);

    const params = new URL(queueCall(fetchMock, 2)[0]).searchParams;
    expect(params.get("search")).toBe("vpn");
    expect(params.get("page")).toBe("1");

    vi.useRealTimers();
  });

  it("the Status filter fires a request carrying status, resetting to page 1", async () => {
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByRole("table");
    const initialParams = new URL(queueCall(fetchMock, 1)[0]).searchParams;
    expect(initialParams.has("status")).toBe(false);

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "OPEN" },
    });
    await screen.findByRole("table");

    expect(queueCallCount(fetchMock)).toBe(2);
    const params = new URL(queueCall(fetchMock, 2)[0]).searchParams;
    expect(params.get("status")).toBe("OPEN");
    expect(params.get("page")).toBe("1");
  });

  it("the Sort select and a sortable column header both drive sort+direction in the request", async () => {
    const fetchMock = mockFetch();
    renderScreen();

    let table = await screen.findByRole("table");
    // Default sort (ui-spec.md §9 / api.ts): itPriority, descending.
    const defaultParams = new URL(queueCall(fetchMock, 1)[0]).searchParams;
    expect(defaultParams.get("sort")).toBe("itPriority");
    expect(defaultParams.get("direction")).toBe("desc");

    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "ticketNumber-asc" },
    });
    table = await screen.findByRole("table");
    expect(queueCallCount(fetchMock)).toBe(2);
    let params = new URL(queueCall(fetchMock, 2)[0]).searchParams;
    expect(params.get("sort")).toBe("ticketNumber");
    expect(params.get("direction")).toBe("asc");

    // Column header click on "Last Updated": not the active sort field, so
    // it switches to updatedAt at that column's own default (descending).
    const lastUpdatedHeader = within(table).getByRole("button", {
      name: /sort by last updated/i,
    });
    fireEvent.click(lastUpdatedHeader);
    await screen.findByRole("table");
    expect(queueCallCount(fetchMock)).toBe(3);
    params = new URL(queueCall(fetchMock, 3)[0]).searchParams;
    expect(params.get("sort")).toBe("updatedAt");
    expect(params.get("direction")).toBe("desc");
    expect(params.get("page")).toBe("1");
  });
});

describe("Pagination", () => {
  it("clicking a numbered page fires a request with the updated page", async () => {
    const PAGE_1 = {
      items: [TICKET_ASSIGNED, TICKET_UNASSIGNED],
      page: 1,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
    };
    const PAGE_2 = {
      items: [TICKET_ASSIGNED],
      page: 2,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
    };
    const fetchMock = mockFetch((input) => {
      const page = new URL(input).searchParams.get("page");
      return jsonResponse(200, page === "2" ? PAGE_2 : PAGE_1);
    });
    renderScreen();

    await screen.findByRole("table");
    expect(screen.getByText("Showing 1–20 of 45")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    await screen.findByRole("table");

    expect(queueCallCount(fetchMock)).toBe(2);
    expect(
      new URL(queueCall(fetchMock, 2)[0]).searchParams.get("page"),
    ).toBe("2");
    expect(screen.getByText("Showing 21–40 of 45")).toBeInTheDocument();
  });
});

describe("Mobile card layout (< 768px)", () => {
  it("renders one card per ticket with number+status, summary, and the IT Priority/Owner/Last Updated meta row, and no table", async () => {
    stubMatchMedia(false);
    mockFetch();
    renderScreen();

    const cards = await screen.findAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const [assignedCard, unassignedCard] = cards;

    expect(
      within(assignedCard).getByRole("link", { name: "TKT-2026-000021" }),
    ).toHaveAttribute("href", "/staff/tickets/21");
    expect(within(assignedCard).getByText("Open")).toBeInTheDocument();
    expect(
      within(assignedCard).getByText("Printer not connecting to network"),
    ).toBeInTheDocument();
    expect(within(assignedCard).getByText("IT: High")).toBeInTheDocument();
    const assignedOwner = within(assignedCard).getByText("Alex Rivera");
    expect(assignedOwner.closest("[data-owner]")).toHaveAttribute(
      "data-owner",
      "assigned",
    );
    expect(
      within(assignedCard).getByText(formatDateTime(TICKET_ASSIGNED.updatedAt)),
    ).toBeInTheDocument();

    const unassignedLabel = within(unassignedCard).getByText("Unassigned");
    expect(unassignedLabel.closest("[data-owner]")).toHaveAttribute(
      "data-owner",
      "unassigned",
    );

    const viewLink = within(assignedCard).getByRole("link", {
      name: /view ticket tkt-2026-000021/i,
    });
    expect(viewLink).toHaveAttribute("href", "/staff/tickets/21");
  });
});
