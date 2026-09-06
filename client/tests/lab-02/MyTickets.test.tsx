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
import { formatDateTime } from "../../src/tickets/formatDateTime.ts";
import {
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";

// Covers docs/lab-02/tests.md rows C-22, C-23, and C-28. Pagination (C-24)
// and the empty / no-results / over-page states (C-25, C-26, C-27) belong
// to the next slice.

const API_BASE_URL = "http://localhost:3000";
const TICKETS_URL = `${API_BASE_URL}/api/tickets`;
const CATEGORIES_URL = `${API_BASE_URL}/api/categories`;

// Category filter options (ui-spec.md §9's controls bar fetches these via
// `GET /api/categories` on mount, independent of the tickets fetch). Named
// to match the two seed tickets' own categories below, so a C-23 test that
// filters by one of these is exercising a realistic scenario.
const CATEGORIES = [
  { id: 4, name: "Network" },
  { id: 2, name: "Hardware" },
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
