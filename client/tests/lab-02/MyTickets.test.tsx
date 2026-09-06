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
import { MyTicketsScreen } from "../../src/screens/MyTicketsScreen.tsx";
import { RequesterSelectionScreen } from "../../src/screens/RequesterSelectionScreen.tsx";
import { formatDateTime } from "../../src/tickets/formatDateTime.ts";
import {
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";

// Covers docs/lab-02/tests.md rows C-22 through C-28, plus AC-09 (the
// My-Tickets-side half of the Requester-switch reset; tests.md files C-08
// under AppShell.test.tsx for the id/name-context half).

const API_BASE_URL = "http://localhost:3000";
const TICKETS_URL = `${API_BASE_URL}/api/tickets`;
const CATEGORIES_URL = `${API_BASE_URL}/api/categories`;
const REQUESTERS_URL = `${API_BASE_URL}/api/requesters`;

// Category filter options (ui-spec.md §9's controls bar fetches these via
// `GET /api/categories` on mount, independent of the tickets fetch). Named
// to match the two seed tickets' own categories below, so a C-23 test that
// filters by one of these is exercising a realistic scenario.
const CATEGORIES = [
  { id: 4, name: "Network" },
  { id: 2, name: "Hardware" },
];

// Development Requesters for the AC-09 switch test: id 1 matches
// `Bootstrap`'s initial seed below, so "Change Requester → id 2" is a real
// switch, not a no-op.
const ACTIVE_REQUESTERS = [
  { id: 1, name: "Jennifer Anderson", email: "jennifer.anderson@example.edu" },
  { id: 2, name: "Michael Brown", email: "michael.brown@example.edu" },
];

const TICKET_WITH_ATTACHMENTS = {
  id: 12,
  ticketNumber: "TKT-2026-000012",
  summary: "Cannot connect to VPN",
  category: { id: 4, name: "Network" },
  relatedSystem: { id: 3, name: "VPN" },
  requestedPriority: "HIGH",
  status: "NEW",
  createdAt: "2026-09-01T02:08:00.000Z",
  updatedAt: "2026-09-01T02:45:00.000Z",
  activeAttachmentCount: 2,
};

const TICKET_WITHOUT_ATTACHMENTS = {
  id: 11,
  ticketNumber: "TKT-2026-000011",
  summary: "Laptop battery drains quickly",
  category: { id: 2, name: "Hardware" },
  relatedSystem: { id: 7, name: "Corporate Laptop" },
  requestedPriority: "MEDIUM",
  status: "NEW",
  createdAt: "2026-09-01T02:14:00.000Z",
  updatedAt: "2026-09-01T02:14:00.000Z",
  activeAttachmentCount: 0,
};

const TICKETS_RESPONSE = {
  items: [TICKET_WITH_ATTACHMENTS, TICKET_WITHOUT_ATTACHMENTS],
  meta: {
    page: 1,
    pageSize: 10,
    totalItems: 2,
    totalPages: 1,
    sort: "createdAt",
    order: "desc",
  },
};

// Long enough that ellipsis truncation (ui-spec.md §11, `max-width: 240px`
// on desktop / 100% on mobile) is the realistic case, not an edge case.
const LONG_SUMMARY =
  "Users in the north building report the VPN client disconnecting every few minutes during video calls, which never happened before last week's firmware update";
const LONG_RELATED_SYSTEM_NAME =
  "Corporate Virtual Private Network Concentrator Appliance Cluster (Primary Data Center)";

const TICKET_WITH_LONG_TEXT = {
  id: 99,
  ticketNumber: "TKT-2026-000099",
  summary: LONG_SUMMARY,
  category: { id: 4, name: "Network" },
  relatedSystem: { id: 5, name: LONG_RELATED_SYSTEM_NAME },
  requestedPriority: "LOW",
  status: "NEW",
  createdAt: "2026-09-01T02:08:00.000Z",
  updatedAt: "2026-09-01T02:08:00.000Z",
  activeAttachmentCount: 0,
};

const LONG_TEXT_RESPONSE = {
  items: [TICKET_WITH_LONG_TEXT],
  meta: {
    page: 1,
    pageSize: 10,
    totalItems: 1,
    totalPages: 1,
    sort: "createdAt",
    order: "desc",
  },
};

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

type TicketsHandler = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function mockFetch(ticketsHandler?: TicketsHandler) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.startsWith(TICKETS_URL)) {
      return (
        ticketsHandler ?? (() => jsonResponse(200, TICKETS_RESPONSE))
      )(input, init);
    }
    if (input.startsWith(CATEGORIES_URL)) {
      return jsonResponse(200, CATEGORIES);
    }
    if (input.startsWith(REQUESTERS_URL)) {
      return jsonResponse(200, ACTIVE_REQUESTERS);
    }
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Number of `/api/tickets` calls `fetchMock` has recorded — excludes the
 * one `/api/categories` call the C-23 controls bar also fires on mount. */
function ticketsCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([input]: [string]) =>
    input.startsWith(TICKETS_URL),
  ).length;
}

/** The `[url, init]` args of the Nth (1-indexed) `/api/tickets` call. */
function ticketsCall(
  fetchMock: ReturnType<typeof vi.fn>,
  n: number,
): [string, RequestInit | undefined] {
  const calls = fetchMock.mock.calls.filter(([input]: [string]) =>
    input.startsWith(TICKETS_URL),
  ) as [string, RequestInit | undefined][];
  return calls[n - 1];
}

/** One page's worth of dummy items — `count` tickets numbered from `start`,
 * for tests where the pagination `meta` is what's under test, not any
 * particular ticket's content. */
function makeTickets(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = start + index;
    return {
      id: n,
      ticketNumber: `TKT-2026-${String(n).padStart(6, "0")}`,
      summary: `Ticket ${n}`,
      category: CATEGORIES[0],
      relatedSystem: { id: 3, name: "VPN" },
      requestedPriority: "LOW",
      status: "NEW",
      createdAt: "2026-09-01T02:08:00.000Z",
      updatedAt: "2026-09-01T02:08:00.000Z",
      activeAttachmentCount: 0,
    };
  });
}

/** A 3-page (30-item, pageSize-10) `/api/tickets` handler whose response
 * `meta.page` always echoes back whatever `page` the request asked for —
 * used by the page-reset tests below, where the fixed 2-item payload keeps
 * each response focused on `meta.page`, not on distinguishing item content
 * per page (C-24 above already covers that). */
function manyPagesHandler(): TicketsHandler {
  return (input) => {
    const page = Number(new URL(input).searchParams.get("page") ?? "1");
    return jsonResponse(200, {
      items: [TICKET_WITH_ATTACHMENTS, TICKET_WITHOUT_ATTACHMENTS],
      meta: {
        page,
        pageSize: 10,
        totalItems: 30,
        totalPages: 3,
        sort: "createdAt",
        order: "desc",
      },
    });
  };
}

/** Drives the screen from its initial page 1 load to page 3, awaiting the
 * list between each click since ui-spec.md §9's Loading row disables the
 * pagination controls (including the page-number buttons) while a request
 * is in flight — clicking "Page 3" before "Page 2"'s request has resolved
 * would land on a still-disabled button and silently do nothing. */
async function goToPage3(fetchMock: ReturnType<typeof vi.fn>) {
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
  await screen.findByRole("table");
  expect(ticketsCallCount(fetchMock)).toBe(2);
  expect(new URL(ticketsCall(fetchMock, 2)[0]).searchParams.get("page")).toBe(
    "2",
  );

  fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
  await screen.findByRole("table");
  expect(ticketsCallCount(fetchMock)).toBe(3);
  expect(new URL(ticketsCall(fetchMock, 3)[0]).searchParams.get("page")).toBe(
    "3",
  );
}

/**
 * jsdom has no `window.matchMedia` implementation. This stub is fixed for
 * the lifetime of one test — MyTicketsScreen reads it once at mount via
 * useMediaQuery — so a "desktop" test and a "mobile" test each drive the
 * hook to a different, real viewport rather than both only ever exercising
 * the same branch.
 */
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

  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue(mediaQueryList),
  );
}

/**
 * Seeds RequesterContext the same way a real Continue click / route guard
 * pass would (mirrors CreateTicket.test.tsx's identical helper), so
 * MyTicketsScreen can be rendered directly without RequireRequester.
 */
function Bootstrap({ children }: { children: ReactNode }) {
  const { requesterName, selectRequester } = useRequester();

  useEffect(() => {
    if (requesterName === null) {
      selectRequester({ id: 1, name: "Jennifer Anderson" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (requesterName === null) return null;

  return <>{children}</>;
}

function renderScreen() {
  return render(
    <RequesterProvider>
      <Bootstrap>
        <MemoryRouter initialEntries={["/tickets"]}>
          <Routes>
            <Route path="/tickets" element={<MyTicketsScreen />} />
            <Route path="/tickets/:id" element={<h1>Ticket Details</h1>} />
            {/* Only exercised by the AC-09 Requester-switch test below —
                RequesterBadge's "Change Requester" navigates here for real. */}
            <Route
              path="/select-requester"
              element={<RequesterSelectionScreen />}
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
  // A no-op when a test never switched to fake timers (C-23's debounce
  // test does); always restoring here means a failure mid-test can never
  // leak fake timers into the next test's real-timer `findBy*` calls.
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("C-22 My Tickets list render", () => {
  it("desktop (>=768px): table shows the eight FR-30 columns, badges, and a keyboard-reachable View link, with no attachment column", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch();
    renderScreen();

    const table = await screen.findByRole("table");
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);

    expect(headers).toEqual([
      "Ticket No.",
      "Created",
      "Summary",
      "Category",
      "Related System",
      "Priority",
      "Status",
      "Last Updated",
      "Actions",
    ]);
    expect(headers.join(" ")).not.toMatch(/attachment|📎/i);
    expect(screen.queryByText(/📎/)).not.toBeInTheDocument();

    // No card list is also in the DOM (exactly one layout renders).
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 data rows

    expect(
      screen.getByRole("link", { name: "TKT-2026-000012" }),
    ).toHaveAttribute("href", "/tickets/12");
    // Scoped to the table (rather than the whole document): the C-23
    // controls bar's Priority/Status filter selects render "High"/"New" as
    // <option> text too, so an unscoped query would be ambiguous.
    expect(within(table).getByText("Cannot connect to VPN")).toBeInTheDocument();
    expect(within(table).getByText("Network")).toBeInTheDocument();
    expect(within(table).getByText("VPN")).toBeInTheDocument();
    expect(within(table).getByText("High")).toBeInTheDocument();
    expect(within(table).getAllByText("New")).toHaveLength(2);
    expect(
      within(table).getByText(formatDateTime(TICKET_WITH_ATTACHMENTS.createdAt)),
    ).toBeInTheDocument();
    expect(
      within(table).getByText(formatDateTime(TICKET_WITH_ATTACHMENTS.updatedAt)),
    ).toBeInTheDocument();

    // Explicit, keyboard-reachable "View" affordance distinct from the
    // ticket-number link (ui-spec.md §12).
    const viewLink = screen.getByRole("link", {
      name: /view ticket tkt-2026-000012/i,
    });
    expect(viewLink.tagName).toBe("A");
    expect(viewLink).toHaveAttribute("href", "/tickets/12");

    fireEvent.click(viewLink);
    expect(
      await screen.findByRole("heading", { name: /ticket details/i }),
    ).toBeInTheDocument();

    // Requester-scoped per api-spec.md §1.2/§3.2. Read via `ticketsCall`,
    // not `fetchMock.mock.calls[0]` directly: the C-23 controls bar's
    // `/api/categories` call (unrelated to Requester scoping) can land
    // first depending on effect order.
    const [, init] = ticketsCall(fetchMock, 1) as [string, RequestInit];
    expect(init.headers).toMatchObject({ "X-Requester-Id": "1" });
  });

  it("mobile (<768px): cards show the same fields as desktop, plus a 📎 count only when > 0, with a View link to /tickets/:id", async () => {
    stubMatchMedia(false);
    mockFetch();
    renderScreen();

    await screen.findByRole("list");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    // No table is also in the DOM (exactly one layout renders).
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const [cardWithAttachments, cardWithoutAttachments] = items;

    expect(
      within(cardWithAttachments).getByRole("link", {
        name: "TKT-2026-000012",
      }),
    ).toHaveAttribute("href", "/tickets/12");
    expect(
      within(cardWithAttachments).getByText("Cannot connect to VPN"),
    ).toBeInTheDocument();
    expect(
      within(cardWithAttachments).getByText("Network · VPN"),
    ).toBeInTheDocument();
    expect(
      within(cardWithAttachments).getByText(
        `Created ${formatDateTime(TICKET_WITH_ATTACHMENTS.createdAt)}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(cardWithAttachments).getByText(
        `Updated ${formatDateTime(TICKET_WITH_ATTACHMENTS.updatedAt)}`,
      ),
    ).toBeInTheDocument();
    expect(within(cardWithAttachments).getByText("High")).toBeInTheDocument();
    expect(within(cardWithAttachments).getByText("New")).toBeInTheDocument();
    // The one mobile-only field: 📎 count shown because it is > 0.
    expect(
      within(cardWithAttachments).getByText("📎 2"),
    ).toBeInTheDocument();

    const viewLink = within(cardWithAttachments).getByRole("link", {
      name: /view ticket tkt-2026-000012/i,
    });
    expect(viewLink).toHaveAttribute("href", "/tickets/12");

    // activeAttachmentCount === 0 ⇒ no paperclip at all (ui-spec.md §9).
    expect(
      within(cardWithoutAttachments).queryByText(/📎/),
    ).not.toBeInTheDocument();
  });
});

describe("C-23 My Tickets controls fire correct query", () => {
  it("debounces the search box 300ms: rapid typing fires no request per keystroke, then exactly one request carries the final value", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(1);

    vi.useFakeTimers();
    const searchInput = screen.getByLabelText("Search");

    // Three keystrokes, each within the previous one's 300ms window, so
    // each restarts the timer instead of letting it fire.
    fireEvent.change(searchInput, { target: { value: "v" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(searchInput, { target: { value: "vp" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(searchInput, { target: { value: "vpn" } });

    // Half of "debounced": 299ms after the last keystroke, still nothing —
    // rapid typing alone never fires a request per keystroke.
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(ticketsCallCount(fetchMock)).toBe(1);

    // The other half: the remaining 1ms completes the 300ms window since
    // the *last* keystroke, and exactly one new request fires, carrying
    // the final typed value.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(ticketsCallCount(fetchMock)).toBe(2);

    const [finalUrl] = ticketsCall(fetchMock, 2);
    expect(new URL(finalUrl).searchParams.get("search")).toBe("vpn");

    vi.useRealTimers();
  });

  it("Category, Priority, and Status filters combine as AND in the request params", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(1);

    // Default (unfiltered) request sends none of these params.
    const [initialUrl] = ticketsCall(fetchMock, 1);
    const initialParams = new URL(initialUrl).searchParams;
    expect(initialParams.has("categoryId")).toBe(false);
    expect(initialParams.has("priority")).toBe(false);
    expect(initialParams.has("status")).toBe(false);

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: String(CATEGORIES[0].id) },
    });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "NEW" },
    });

    // Each filter change fires its own request (no debounce on selects):
    // 1 initial + 3 changes.
    expect(ticketsCallCount(fetchMock)).toBe(4);

    // The final request carries all three simultaneously — combined AND,
    // not each filter overwriting the last.
    const [finalUrl] = ticketsCall(fetchMock, 4);
    const finalParams = new URL(finalUrl).searchParams;
    expect(finalParams.get("categoryId")).toBe(String(CATEGORIES[0].id));
    expect(finalParams.get("priority")).toBe("HIGH");
    expect(finalParams.get("status")).toBe("NEW");
  });

  it("the Sort select and the sortable column headers both drive sort+order in the request", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(1);

    // Default is "Created (newest)" (ui-spec.md §9).
    const defaultParams = new URL(
      ticketsCall(fetchMock, 1)[0],
    ).searchParams;
    expect(defaultParams.get("sort")).toBe("createdAt");
    expect(defaultParams.get("order")).toBe("desc");

    // Sort select: "Ticket number (A→Z)" → sort=ticketNumber&order=asc.
    // Controls (including this select) are disabled while a request is in
    // flight (ui-spec.md §9's Loading row), so each step below awaits the
    // list re-loading before the next interaction — otherwise the next
    // fireEvent would land on a still-disabled control and silently do
    // nothing, which is exactly the failure mode this awaits around.
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "ticketNumber-asc" },
    });
    let table = await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(2);
    let params = new URL(ticketsCall(fetchMock, 2)[0]).searchParams;
    expect(params.get("sort")).toBe("ticketNumber");
    expect(params.get("order")).toBe("asc");

    // Column header click on "Last Updated": not yet the active sort
    // field, so it switches to updatedAt at that column's own default
    // order (descending).
    let lastUpdatedHeader = within(table).getByRole("button", {
      name: /sort by last updated/i,
    });
    fireEvent.click(lastUpdatedHeader);
    table = await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(3);
    params = new URL(ticketsCall(fetchMock, 3)[0]).searchParams;
    expect(params.get("sort")).toBe("updatedAt");
    expect(params.get("order")).toBe("desc");

    // Clicking the same header again toggles the order (desc → asc),
    // rather than doing nothing or resetting to a default.
    lastUpdatedHeader = within(table).getByRole("button", {
      name: /sort by last updated/i,
    });
    fireEvent.click(lastUpdatedHeader);
    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(4);
    params = new URL(ticketsCall(fetchMock, 4)[0]).searchParams;
    expect(params.get("sort")).toBe("updatedAt");
    expect(params.get("order")).toBe("asc");
  });
});

describe("C-24 My Tickets pagination", () => {
  it("Next fetches page 2, 'Showing a-b of total' comes from meta, and Prev is disabled only on page 1", async () => {
    stubMatchMedia(true);
    const PAGE_1 = {
      items: makeTickets(1, 10),
      meta: {
        page: 1,
        pageSize: 10,
        totalItems: 22,
        totalPages: 3,
        sort: "createdAt",
        order: "desc",
      },
    };
    const PAGE_2 = {
      items: makeTickets(11, 10),
      meta: {
        page: 2,
        pageSize: 10,
        totalItems: 22,
        totalPages: 3,
        sort: "createdAt",
        order: "desc",
      },
    };
    const fetchMock = mockFetch((input) => {
      const page = new URL(input).searchParams.get("page");
      return jsonResponse(200, page === "2" ? PAGE_2 : PAGE_1);
    });
    renderScreen();

    await screen.findByRole("table");
    expect(screen.getByText("Showing 1–10 of 22")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
    // Numbered pages: the current page's own button is also disabled
    // (nothing to gain by re-requesting the page already shown).
    expect(screen.getByRole("button", { name: "Page 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Page 2" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByRole("table");

    expect(ticketsCallCount(fetchMock)).toBe(2);
    expect(
      new URL(ticketsCall(fetchMock, 2)[0]).searchParams.get("page"),
    ).toBe("2");
    expect(screen.getByText("Showing 11–20 of 22")).toBeInTheDocument();
    // Prev is enabled once off page 1; Next stays enabled (page 2 of 3).
    expect(screen.getByRole("button", { name: /prev/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();

    // A numbered-page button (not just Next) also drives the request —
    // clicking "Page 1" goes directly back, not merely toggling Prev.
    fireEvent.click(screen.getByRole("button", { name: "Page 1" }));
    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(3);
    expect(
      new URL(ticketsCall(fetchMock, 3)[0]).searchParams.get("page"),
    ).toBe("1");
    expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
  });

  it("changing the rows-per-page select sends the new pageSize", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByRole("table");
    expect(
      new URL(ticketsCall(fetchMock, 1)[0]).searchParams.get("pageSize"),
    ).toBe("10");

    fireEvent.change(screen.getByLabelText("Rows"), {
      target: { value: "20" },
    });
    await screen.findByRole("table");

    expect(ticketsCallCount(fetchMock)).toBe(2);
    expect(
      new URL(ticketsCall(fetchMock, 2)[0]).searchParams.get("pageSize"),
    ).toBe("20");
  });
});

describe("C-25 My Tickets empty state", () => {
  it("shows EmptyState with a 'create your first ticket' CTA when the Requester owns zero tickets — not the no-results state", async () => {
    stubMatchMedia(true);
    mockFetch(() =>
      jsonResponse(200, {
        items: [],
        meta: {
          page: 1,
          pageSize: 10,
          totalItems: 0,
          totalPages: 0,
          sort: "createdAt",
          order: "desc",
        },
      }),
    );
    renderScreen();

    expect(
      await screen.findByRole("heading", {
        name: "You haven't created any tickets yet.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create your first ticket/i }),
    ).toBeInTheDocument();

    // Not the no-results presentation.
    expect(
      screen.queryByText("No tickets match your search or filters."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^clear filters$/i }),
    ).not.toBeInTheDocument();

    // AC-29: "Filters/search hidden ... nothing to filter" — the whole
    // controls bar is gone, not just disabled-and-invisible-anyway.
    expect(screen.queryByLabelText("Search")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sort")).not.toBeInTheDocument();

    // No list, and no pagination summary for an empty list.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/^showing /i)).not.toBeInTheDocument();
  });
});

describe("C-26 My Tickets no-results state", () => {
  it("shows NoResultsState with Clear filters when an active filter matches nothing, keeping the filter bar visible and populated", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch((input) => {
      const categoryId = new URL(input).searchParams.get("categoryId");
      if (categoryId === String(CATEGORIES[0].id)) {
        return jsonResponse(200, {
          items: [],
          meta: {
            page: 1,
            pageSize: 10,
            totalItems: 0,
            totalPages: 0,
            sort: "createdAt",
            order: "desc",
          },
        });
      }
      return jsonResponse(200, TICKETS_RESPONSE);
    });
    renderScreen();

    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: String(CATEGORIES[0].id) },
    });

    const noResultsMessage = await screen.findByText(
      "No tickets match your search or filters.",
    );
    expect(noResultsMessage).toBeInTheDocument();
    expect(ticketsCallCount(fetchMock)).toBe(2);
    // Scoped to the no-results block itself: the header's own "Clear
    // filters" button (ui-spec.md §9) is also visible right now — the
    // Category filter it clears is exactly what's non-default — so an
    // unscoped query would match two buttons of the same name.
    const noResultsRegion = noResultsMessage.parentElement as HTMLElement;
    const clearButton = within(noResultsRegion).getByRole("button", {
      name: /clear filters/i,
    });
    expect(clearButton).toBeInTheDocument();

    // Not the true-empty presentation.
    expect(
      screen.queryByText("You haven't created any tickets yet."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /create your first ticket/i }),
    ).not.toBeInTheDocument();

    // BR-37: the filter bar stays visible AND populated — not hidden, not
    // reset back to defaults.
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toHaveValue(
      String(CATEGORIES[0].id),
    );

    // Clear filters recovers the list.
    fireEvent.click(clearButton);
    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(3);
    expect(screen.getByLabelText("Category")).toHaveValue("");
  });
});

describe("C-27 My Tickets last/over page", () => {
  it("shows 'No more tickets on this page.' with a Back to page 1 action when the requested page is past the end — not an error", async () => {
    stubMatchMedia(true);
    const PAGE_1 = {
      items: makeTickets(1, 10),
      meta: {
        page: 1,
        pageSize: 10,
        totalItems: 15,
        totalPages: 2,
        sort: "createdAt",
        order: "desc",
      },
    };
    // Simulates tickets having been removed between page 1 loading (which
    // advertised 2 pages) and the page-2 request landing: the API still
    // returns 200 with items: [] and a meta reflecting the now-smaller
    // count (api-spec.md §3.2, BR-19, AC-27) — never an error.
    const OVER_PAGE = {
      items: [],
      meta: {
        page: 2,
        pageSize: 10,
        totalItems: 5,
        totalPages: 1,
        sort: "createdAt",
        order: "desc",
      },
    };
    const fetchMock = mockFetch((input) => {
      const page = new URL(input).searchParams.get("page");
      return jsonResponse(200, page === "2" ? OVER_PAGE : PAGE_1);
    });
    renderScreen();

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(
      await screen.findByText("No more tickets on this page."),
    ).toBeInTheDocument();
    const backButton = screen.getByRole("button", {
      name: /back to page 1/i,
    });
    expect(backButton).toBeInTheDocument();

    // Not an error — no alert region, and not the plain no-results wording.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No tickets match your search or filters."),
    ).not.toBeInTheDocument();

    fireEvent.click(backButton);
    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(3);
    expect(
      new URL(ticketsCall(fetchMock, 3)[0]).searchParams.get("page"),
    ).toBe("1");
  });
});

describe("Page resets to 1 on filter/search/sort/page-size change (bug guard, ui-spec.md §9)", () => {
  it("changing the Category filter while on page 3 resets to page 1", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch(manyPagesHandler());
    renderScreen();
    await goToPage3(fetchMock);

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: String(CATEGORIES[0].id) },
    });
    await screen.findByRole("table");

    expect(ticketsCallCount(fetchMock)).toBe(4);
    const params = new URL(ticketsCall(fetchMock, 4)[0]).searchParams;
    expect(params.get("categoryId")).toBe(String(CATEGORIES[0].id));
    expect(params.get("page")).toBe("1");
  });

  it("changing the Sort select while on page 3 resets to page 1", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch(manyPagesHandler());
    renderScreen();
    await goToPage3(fetchMock);

    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "ticketNumber-asc" },
    });
    await screen.findByRole("table");

    expect(ticketsCallCount(fetchMock)).toBe(4);
    const params = new URL(ticketsCall(fetchMock, 4)[0]).searchParams;
    expect(params.get("sort")).toBe("ticketNumber");
    expect(params.get("page")).toBe("1");
  });

  it("toggling sort via a column header while on page 3 resets to page 1", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch(manyPagesHandler());
    renderScreen();
    await goToPage3(fetchMock);
    // Captured only now, not before goToPage3: each page change flashes a
    // LoadingState in between, unmounting and remounting the table, so an
    // earlier reference would be a detached node clicking on which would
    // silently do nothing to the live component.
    const table = await screen.findByRole("table");

    fireEvent.click(
      within(table).getByRole("button", { name: /sort by last updated/i }),
    );
    await screen.findByRole("table");

    expect(ticketsCallCount(fetchMock)).toBe(4);
    const params = new URL(ticketsCall(fetchMock, 4)[0]).searchParams;
    expect(params.get("sort")).toBe("updatedAt");
    expect(params.get("page")).toBe("1");
  });

  it("committing a debounced search while on page 3 resets to page 1", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch(manyPagesHandler());
    renderScreen();
    await goToPage3(fetchMock);

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "vpn" },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();

    expect(ticketsCallCount(fetchMock)).toBe(4);
    const params = new URL(ticketsCall(fetchMock, 4)[0]).searchParams;
    expect(params.get("search")).toBe("vpn");
    expect(params.get("page")).toBe("1");
  });

  it("changing the rows-per-page select while on page 3 resets to page 1", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch(manyPagesHandler());
    renderScreen();
    await goToPage3(fetchMock);

    fireEvent.change(screen.getByLabelText("Rows"), {
      target: { value: "20" },
    });
    await screen.findByRole("table");

    expect(ticketsCallCount(fetchMock)).toBe(4);
    const params = new URL(ticketsCall(fetchMock, 4)[0]).searchParams;
    expect(params.get("pageSize")).toBe("20");
    expect(params.get("page")).toBe("1");
  });

  it("clicking Clear filters while on page 3 resets to page 1", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch(manyPagesHandler());
    renderScreen();
    await goToPage3(fetchMock);

    // Move a filter off default first so Clear filters is present to click
    // (it's hidden at defaults) — this also means the assertion below is
    // load-bearing for the page reset specifically, not just a no-op.
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: String(CATEGORIES[0].id) },
    });
    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(4);

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    await screen.findByRole("table");

    expect(ticketsCallCount(fetchMock)).toBe(5);
    const params = new URL(ticketsCall(fetchMock, 5)[0]).searchParams;
    expect(params.has("categoryId")).toBe(false);
    expect(params.get("page")).toBe("1");
  });
});

describe("Clear filters (ui-spec.md §9, supports C-23, no dedicated tests.md row)", () => {
  it("is absent at defaults, appears once a filter is non-default, and clicking it resets every control and re-fetches with no filter params", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(1);

    // Absent while every control is still at its default.
    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).not.toBeInTheDocument();

    // Drive every control the button claims to reset away from its
    // default — not just Category — so the post-clear assertions below
    // are load-bearing for each one individually, not just coincidentally
    // true because that control was never touched. Search needs the real
    // 300ms debounce to actually land as a fired request (same fake-timer
    // technique as the C-23 debounce test); the rest fire immediately.
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "vpn" },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(ticketsCallCount(fetchMock)).toBe(2);
    expect(
      new URL(ticketsCall(fetchMock, 2)[0]).searchParams.get("search"),
    ).toBe("vpn");
    vi.useRealTimers();

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: String(CATEGORIES[0].id) },
    });
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "HIGH" },
    });
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "NEW" },
    });
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "ticketNumber-asc" },
    });
    await screen.findByRole("table");

    // Sanity check every one of them actually took effect — otherwise the
    // "resets" assertions below wouldn't prove anything for that control.
    const callsBeforeClear = ticketsCallCount(fetchMock);
    expect(callsBeforeClear).toBe(6); // initial + search + category + priority + status + sort
    const beforeClearParams = new URL(
      ticketsCall(fetchMock, callsBeforeClear)[0],
    ).searchParams;
    expect(beforeClearParams.get("search")).toBe("vpn");
    expect(beforeClearParams.get("categoryId")).toBe(
      String(CATEGORIES[0].id),
    );
    expect(beforeClearParams.get("priority")).toBe("HIGH");
    expect(beforeClearParams.get("status")).toBe("NEW");
    expect(beforeClearParams.get("sort")).toBe("ticketNumber");
    expect(beforeClearParams.get("order")).toBe("asc");

    // Appears once something is non-default.
    const clearButton = await screen.findByRole("button", {
      name: /clear filters/i,
    });

    fireEvent.click(clearButton);
    await screen.findByRole("table");

    // Disappears again — every control read back at default.
    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveValue("");
    expect(screen.getByLabelText("Category")).toHaveValue("");
    expect(screen.getByLabelText("Priority")).toHaveValue("");
    expect(screen.getByLabelText("Status")).toHaveValue("");
    expect(screen.getByLabelText("Sort")).toHaveValue("createdAt-desc");

    // The re-fetch it triggers carries none of the filter params, and the
    // default sort.
    expect(ticketsCallCount(fetchMock)).toBe(callsBeforeClear + 1);
    const finalParams = new URL(
      ticketsCall(fetchMock, callsBeforeClear + 1)[0],
    ).searchParams;
    expect(finalParams.has("search")).toBe(false);
    expect(finalParams.has("categoryId")).toBe(false);
    expect(finalParams.has("priority")).toBe(false);
    expect(finalParams.has("status")).toBe(false);
    expect(finalParams.get("sort")).toBe("createdAt");
    expect(finalParams.get("order")).toBe("desc");
  });
});

describe("AC-09 My Tickets resets on Requester switch (tests.md C-08 covers the id/name-context half in AppShell.test.tsx)", () => {
  it("switching Requesters via Change Requester resets search/filters/sort to defaults and reloads for the new Requester with no filter params", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByRole("table");
    expect(ticketsCallCount(fetchMock)).toBe(1);

    // Drive every control away from its default for the original Requester
    // (1). The search half needs the real 300ms debounce to actually land
    // as a fired request — fake timers here, same technique as the C-23
    // debounce test — before switching back to real timers for the
    // multi-screen navigation below (`findByRole` polling needs real
    // timers).
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "vpn" },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(ticketsCallCount(fetchMock)).toBe(2);
    expect(
      new URL(ticketsCall(fetchMock, 2)[0]).searchParams.get("search"),
    ).toBe("vpn");
    vi.useRealTimers();

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: String(CATEGORIES[0].id) },
    });
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "ticketNumber-asc" },
    });
    await screen.findByRole("table");

    const callsBeforeSwitch = ticketsCallCount(fetchMock);
    expect(callsBeforeSwitch).toBe(4); // initial + search + category + sort

    // The last request for Requester 1 really does carry the non-default
    // state — the baseline the reset below has to actually undo.
    const beforeSwitchParams = new URL(
      ticketsCall(fetchMock, callsBeforeSwitch)[0],
    ).searchParams;
    expect(beforeSwitchParams.get("search")).toBe("vpn");
    expect(beforeSwitchParams.get("categoryId")).toBe(
      String(CATEGORIES[0].id),
    );
    expect(beforeSwitchParams.get("sort")).toBe("ticketNumber");

    // Change Requester → pick Requester 2 → Continue (the real flow:
    // RequesterBadge navigates to /select-requester, which is a different
    // route than /tickets, so MyTicketsScreen unmounts here and remounts
    // fresh when Continue routes back).
    fireEvent.click(
      screen.getByRole("button", { name: /jennifer anderson/i }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Change Requester" }),
    );

    const requesterSelect = await screen.findByLabelText(
      /development requester/i,
    );
    fireEvent.change(requesterSelect, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const table = await screen.findByRole("table");
    expect(screen.getByText("Michael Brown")).toBeInTheDocument();

    // Exactly one new /api/tickets call for the fresh mount, scoped to the
    // new Requester, with none of the old filters/search/sort carried over.
    expect(ticketsCallCount(fetchMock)).toBe(callsBeforeSwitch + 1);
    const [afterSwitchUrl, afterSwitchInit] = ticketsCall(
      fetchMock,
      callsBeforeSwitch + 1,
    );
    expect(afterSwitchInit?.headers).toMatchObject({ "X-Requester-Id": "2" });
    const afterSwitchParams = new URL(afterSwitchUrl).searchParams;
    expect(afterSwitchParams.has("search")).toBe(false);
    expect(afterSwitchParams.has("categoryId")).toBe(false);
    expect(afterSwitchParams.get("sort")).toBe("createdAt");
    expect(afterSwitchParams.get("order")).toBe("desc");

    // The controls themselves read back at default, and Clear filters is
    // gone again.
    expect(screen.getByLabelText("Search")).toHaveValue("");
    expect(screen.getByLabelText("Category")).toHaveValue("");
    expect(screen.getByLabelText("Sort")).toHaveValue("createdAt-desc");
    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).not.toBeInTheDocument();

    // A fresh table, not a stale one left over from before the switch.
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(0);
  });
});

describe("C-28 My Tickets failure state", () => {
  it("shows role=alert with Retry when the list fetch rejects; Retry re-fetches and recovers", async () => {
    stubMatchMedia(true);
    const fetchMock = mockFetch(() => Promise.reject(new Error("network down")));
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not load your tickets. Please check your connection and try again.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /retry/i });

    fetchMock.mockImplementation((input: string) => {
      if (input.startsWith(TICKETS_URL)) {
        return jsonResponse(200, TICKETS_RESPONSE);
      }
      return jsonResponse(404, {});
    });

    fireEvent.click(retryButton);

    await screen.findByRole("table");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Counts only `/api/tickets` calls: the C-23 controls bar also fires one
    // `/api/categories` call on mount (for the Category filter), which
    // `fetchMock` intercepts too but which isn't what this assertion is
    // about.
    expect(ticketsCallCount(fetchMock)).toBe(2);
  });
});

describe("My Tickets loading state (supports C-22/C-28, no dedicated row)", () => {
  it("shows a polite status region while the request is in flight", () => {
    stubMatchMedia(true);
    mockFetch(() => new Promise(() => {}));
    renderScreen();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// Supports C-22 (part of ui-spec.md §9's field list is meaningless if it
// silently clips) and §11: "Long text truncates with ellipsis and a
// title, never silently clips" — at every viewport. jsdom applies no CSS,
// so these assert the `title` attribute directly rather than measuring
// overflow; that attribute is what a real browser's tooltip reads from.
describe("Truncated fields carry a title with the full text (ui-spec.md §11)", () => {
  it("desktop: the summary and related-system cells carry a title equal to the full untruncated text", async () => {
    stubMatchMedia(true);
    mockFetch(() => jsonResponse(200, LONG_TEXT_RESPONSE));
    renderScreen();

    const table = await screen.findByRole("table");
    expect(within(table).getByTitle(LONG_SUMMARY)).toHaveTextContent(
      LONG_SUMMARY,
    );
    expect(
      within(table).getByTitle(LONG_RELATED_SYSTEM_NAME),
    ).toHaveTextContent(LONG_RELATED_SYSTEM_NAME);
  });

  it("mobile: the summary and related-system fields carry a title equal to the full untruncated text", async () => {
    stubMatchMedia(false);
    mockFetch(() => jsonResponse(200, LONG_TEXT_RESPONSE));
    renderScreen();

    const [card] = await screen.findAllByRole("listitem");
    expect(within(card).getByTitle(LONG_SUMMARY)).toHaveTextContent(
      LONG_SUMMARY,
    );

    // The related-system name renders combined with Category on one line
    // ("Category · Related System", ui-spec.md §9); its title is the full
    // combined text, which carries the related-system name in full.
    const combinedTitle = `${TICKET_WITH_LONG_TEXT.category.name} · ${LONG_RELATED_SYSTEM_NAME}`;
    expect(within(card).getByTitle(combinedTitle)).toHaveTextContent(
      combinedTitle,
    );
  });
});

// The "whole row clickable" requirement (ui-spec.md §9's Loaded-with-rows
// state, §12) is implemented as a stretched link (the identity link's
// ::after covers the row/card — see MyTicketsScreen.css) rather than a
// second overlapping anchor. These lock that invariant: exactly one
// identity link plus the one explicit "View" link, never a third anchor
// added to literally cover the row.
describe("Whole-row-clickable pattern does not duplicate anchors (ui-spec.md §9, §12)", () => {
  it("desktop: each row exposes exactly one identity link besides the View link", async () => {
    stubMatchMedia(true);
    mockFetch();
    renderScreen();

    const table = await screen.findByRole("table");
    const dataRows = within(table).getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(2);

    for (const row of dataRows) {
      const links = within(row).getAllByRole("link");
      expect(links).toHaveLength(2);
      const [identityLink, viewLink] = links;
      expect(viewLink).toHaveAccessibleName(/^view ticket /i);
      expect(identityLink.getAttribute("href")).toBe(
        viewLink.getAttribute("href"),
      );
    }
  });

  it("mobile: each card exposes exactly one identity link besides the View link", async () => {
    stubMatchMedia(false);
    mockFetch();
    renderScreen();

    const cards = await screen.findAllByRole("listitem");
    expect(cards).toHaveLength(2);

    for (const card of cards) {
      const links = within(card).getAllByRole("link");
      expect(links).toHaveLength(2);
      const [identityLink, viewLink] = links;
      expect(viewLink).toHaveAccessibleName(/^view ticket /i);
      expect(identityLink.getAttribute("href")).toBe(
        viewLink.getAttribute("href"),
      );
    }
  });
});
