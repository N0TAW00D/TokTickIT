import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { StaffTicketDetailScreen } from "../../src/screens/StaffTicketDetailScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";

// Lab 4 Actions Taken card on the IT Staff / Administrator Ticket Detail
// (ui-spec.md §5.1–§5.2, api-spec.md §2). Rows C-10..C-21, C-28 (Actions part),
// C-29, C-30 of tests.md.

const API = "http://localhost:3000";
const TICKET_ID = 21;
const URLS = {
  ticket: `${API}/api/tickets/${TICKET_ID}`,
  status: `${API}/api/tickets/${TICKET_ID}/status`,
  history: `${API}/api/tickets/${TICKET_ID}/status-history`,
  actions: `${API}/api/tickets/${TICKET_ID}/actions-taken`,
  comments: `${API}/api/tickets/${TICKET_ID}/comments`,
  notes: `${API}/api/tickets/${TICKET_ID}/notes`,
  assignable: `${API}/api/staff/assignable-users`,
};
const actionUrl = (id: number) => `${URLS.actions}/${id}`;

function ticketBody(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    ticketNumber: "TKT-2026-000021",
    requester: { id: 7, name: "Jennifer Anderson", email: "j@example.edu" },
    category: { id: 4, name: "Network" },
    relatedSystem: { id: 7, name: "Corporate Laptop" },
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    status: "IN_PROGRESS",
    owner: { id: 9, name: "Jordan Lee" },
    requesterResolvedAt: null,
    summary: "Printer not connecting to network",
    description: "The printer disconnects every few minutes.",
    createdAt: "2026-09-01T08:14:00.000Z",
    updatedAt: "2026-09-05T09:30:00.000Z",
    attachments: [],
    version: 3,
    ...overrides,
  };
}

function res(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function action(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ticketId: TICKET_ID,
    actionAt: "2026-10-01T03:00:00.000Z",
    description: `Description ${id}`,
    result: null,
    status: "PLANNED",
    performedBy: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
    assignee: null,
    followUpRequired: false,
    followUpNote: null,
    attachmentNotes: null,
    lastUpdatedBy: { id: 9, name: "Jordan Lee" },
    createdAt: "2026-10-01T03:05:00.000Z",
    updatedAt: "2026-10-01T03:05:00.000Z",
    version: 1,
    ...overrides,
  };
}

interface Handlers {
  ticket?: () => Promise<Response>;
  actions?: () => Promise<Response>;
  post?: (body: Record<string, unknown>) => Promise<Response>;
  patch?: (id: number, body: Record<string, unknown>) => Promise<Response>;
  assignable?: unknown[];
}

function mockFetch(h: Handlers = {}) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === URLS.assignable) return res(200, h.assignable ?? []);
    if (input === URLS.actions && init?.method === "POST") {
      return (h.post ?? (() => res(201, action(99))))(JSON.parse(init.body as string));
    }
    if (input.startsWith(`${URLS.actions}/`) && init?.method === "PATCH") {
      const id = Number(input.slice(URLS.actions.length + 1));
      return (h.patch ?? (() => res(200, action(id))))(id, JSON.parse(init.body as string));
    }
    if (input === URLS.ticket && init?.method === undefined) {
      return (h.ticket ?? (() => res(200, ticketBody())))();
    }
    if (input === URLS.history) return res(200, []);
    if (input === URLS.actions) return (h.actions ?? (() => res(200, [])))();
    if (input === URLS.comments || input === URLS.notes) return res(200, []);
    return res(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type FetchMock = ReturnType<typeof mockFetch>;

function writes(fetchMock: FetchMock, method: "POST" | "PATCH") {
  return fetchMock.mock.calls.filter(
    ([u, init]: [string, RequestInit?]) =>
      init?.method === method && u.startsWith(URLS.actions),
  );
}

function sentBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string);
}

function listReads(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(
    ([u, init]: [string, RequestInit?]) =>
      u === URLS.actions && init?.method === undefined,
  );
}

const STAFF: AuthUser = {
  id: 9,
  name: "Jordan Lee",
  email: "jordan.lee@example.edu",
  role: "IT_STAFF",
  mustChangePassword: false,
};
const ADMIN: AuthUser = {
  id: 1,
  name: "Alex Admin",
  email: "alex@example.edu",
  role: "ADMINISTRATOR",
  mustChangePassword: false,
};

function Bootstrap({ who, children }: { who: AuthUser; children: ReactNode }) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) setUser(who);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

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

function renderScreen(who: AuthUser = STAFF) {
  return render(
    <AuthProvider>
      <Bootstrap who={who}>
        <MemoryRouter initialEntries={[`/staff/tickets/${TICKET_ID}`]}>
          <Routes>
            <Route path="/staff/tickets/:id" element={<StaffTicketDetailScreen />} />
            <Route path="/staff/tickets" element={<h1>Queue</h1>} />
          </Routes>
        </MemoryRouter>
      </Bootstrap>
    </AuthProvider>,
  );
}

/** Renders the screen and waits until the Actions Taken card has its list. */
async function openCard(who: AuthUser = STAFF) {
  renderScreen(who);
  await screen.findByText("TKT-2026-000021");
  return await screen.findByRole("region", { name: /^Actions Taken/ });
}

async function openCreateForm(who: AuthUser = STAFF) {
  const card = await openCard(who);
  fireEvent.click(within(card).getByRole("button", { name: "Add action" }));
  return card;
}

beforeEach(() => {
  stubMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("C-10 Actions list rendering", () => {
  it("renders a captioned table with the spec columns on a wide layout", async () => {
    mockFetch({ actions: () => res(200, [action(1), action(2, { status: "COMPLETED", result: "Done" })]) });
    const card = await openCard();
    const table = within(card).getByRole("table");
    expect(within(table).getByText("Actions taken on TKT-2026-000021")).toBeTruthy();
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(0, 6)).toEqual([
      "When",
      "Action",
      "Result",
      "Performed by",
      "Status",
      "Follow-up",
    ]);
    expect(within(table).getByText("Description 1")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "Actions Taken (2)" })).toBeTruthy();
  });

  it("states that the card is visible to the requester", async () => {
    mockFetch();
    const card = await openCard();
    expect(within(card).getByText("Visible to the requester")).toBeTruthy();
  });

  it("renders stacked cards, not a table, on a narrow layout", async () => {
    stubMatchMedia(false);
    mockFetch({ actions: () => res(200, [action(1)]) });
    const card = await openCard();
    expect(within(card).queryByRole("table")).toBeNull();
    expect(within(card).getByRole("list")).toBeTruthy();
    expect(within(card).getByText("Description 1")).toBeTruthy();
  });

  it("shows the empty state with an Add action button", async () => {
    mockFetch();
    const card = await openCard();
    expect(within(card).getByText("No actions recorded yet.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Add action" })).toBeTruthy();
  });

  it("offers Edit only on non-terminal rows, with a row-specific label", async () => {
    mockFetch({
      actions: () =>
        res(200, [
          action(1, { status: "PLANNED" }),
          action(2, { status: "IN_PROGRESS" }),
          action(3, { status: "COMPLETED", result: "Done" }),
          action(4, { status: "CANCELLED" }),
        ]),
    });
    const card = await openCard();
    expect(within(card).getAllByRole("button", { name: /^Edit action from / })).toHaveLength(2);
    expect(within(card).getAllByRole("button", { name: /^View action from / })).toHaveLength(4);
    expect(within(card).getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("shows the assignee beneath the performer, an Administrator role badge and the follow-up tag", async () => {
    mockFetch({
      actions: () =>
        res(200, [
          action(1, {
            performedBy: { id: 1, name: "Alex Admin", role: "ADMINISTRATOR" },
            assignee: { id: 8, name: "Carlos Mendes" },
            followUpRequired: true,
            followUpNote: "Check Friday",
          }),
        ]),
    });
    const card = await openCard();
    expect(within(card).getByText("→ Carlos Mendes")).toBeTruthy();
    expect(within(card).getByText("Administrator")).toBeTruthy();
    expect(card.querySelector(".zen-follow-up-tag")?.textContent).toContain("Follow-up");
  });

  it("is placed after the ticket details and before Status history, as #actions-taken", async () => {
    mockFetch();
    const card = await openCard();
    expect(card.id).toBe("actions-taken");
    expect(card.getAttribute("tabindex")).toBe("-1");
    const history = screen.getByRole("region", { name: "Status history" });
    expect(card.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const info = screen.getByRole("heading", { name: "Ticket information" });
    expect(info.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("C-17 Terminal Actions are read-only", () => {
  it.each([
    ["COMPLETED", "Completed actions are read-only."],
    ["CANCELLED", "Cancelled actions are read-only."],
  ])("%s: View shows static fields and the read-only note, no Edit", async (status, note) => {
    mockFetch({
      actions: () =>
        res(200, [
          action(1, {
            status,
            result: "Rebooted the router",
            attachmentNotes: "See vpn-error.png",
            assignee: { id: 8, name: "Carlos Mendes" },
            followUpRequired: true,
            followUpNote: "Check again Friday",
          }),
        ]),
    });
    const card = await openCard();
    expect(within(card).queryByRole("button", { name: /^Edit action/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /^View action from / }));
    const details = card.querySelector(".zen-actions__details") as HTMLElement;
    expect(within(details).getByText(note)).toBeTruthy();
    expect(within(details).getByText("Rebooted the router")).toBeTruthy();
    expect(within(details).getByText("Look for: See vpn-error.png")).toBeTruthy();
    expect(within(details).getByText("Check again Friday")).toBeTruthy();
    expect(within(details).getByText("Logged at")).toBeTruthy();
    expect(details.querySelector("input, textarea, select, button")).toBeNull();
  });

  it("View toggles open and closed with aria-expanded", async () => {
    mockFetch({ actions: () => res(200, [action(1)]) });
    const card = await openCard();
    const view = within(card).getByRole("button", { name: /^View action from / });
    expect(view.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(view);
    expect(view.getAttribute("aria-expanded")).toBe("true");
    expect(within(card).getByText("Last updated by")).toBeTruthy();
    fireEvent.click(view);
    expect(within(card).queryByText("Last updated by")).toBeNull();
  });
});

describe("C-20 Closed Ticket", () => {
  it.each(["CLOSED", "CANCELLED"])("%s hides Add action and shows the closed notice", async (status) => {
    mockFetch({
      ticket: () => res(200, ticketBody({ status })),
      actions: () => res(200, [action(1)]),
    });
    const card = await openCard();
    expect(within(card).queryByRole("button", { name: "Add action" })).toBeNull();
    expect(
      within(card).getByText("This ticket is closed. Actions Taken are read-only."),
    ).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^Edit action/ })).toBeNull();
  });

  it("RESOLVED keeps Add action", async () => {
    mockFetch({ ticket: () => res(200, ticketBody({ status: "RESOLVED" })) });
    const card = await openCard();
    expect(within(card).getByRole("button", { name: "Add action" })).toBeTruthy();
    expect(within(card).queryByText(/This ticket is closed/)).toBeNull();
  });
});

describe("C-28 Safe failure of the Actions list", () => {
  it("shows an ErrorState with Retry and no raw error text; Retry reloads the list", async () => {
    let fail = true;
    const fetchMock = mockFetch({
      actions: () => (fail ? res(500, { error: "INTERNAL", message: "SELECT * FROM leak" }) : res(200, [action(1)])),
    });
    renderScreen();
    const card = await screen.findByRole("region", { name: /^Actions Taken/ });
    const alert = await within(card).findByRole("alert");
    expect(alert.textContent).toContain("Something went wrong");
    expect(card.textContent).not.toMatch(/SELECT|status 500|INTERNAL/);
    expect(within(card).queryByRole("button", { name: "Add action" })).toBeNull();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await within(card).findByText("Description 1")).toBeTruthy();
    expect(listReads(fetchMock).length).toBe(2);
  });

  it("shows a loading state while the list is loading", async () => {
    mockFetch({ actions: () => new Promise<Response>(() => {}) });
    renderScreen();
    const card = await screen.findByRole("region", { name: /^Actions Taken/ });
    expect(within(card).getByRole("status").textContent).toContain("Loading");
  });
});

describe("C-21 Administrator view", () => {
  it("has a usable Actions Taken card but no owner, status or composers; IT Priority stays", async () => {
    mockFetch({ actions: () => res(200, [action(1)]) });
    const card = await openCard(ADMIN);
    expect(within(card).getByRole("button", { name: "Add action" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /^Edit action from / })).toBeTruthy();
    expect(screen.queryByLabelText("Ticket Owner")).toBeNull();
    expect(screen.queryByLabelText("Current Status")).toBeNull();
    expect(screen.getByText("IT Priority")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Medium" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /comment|note/i })).toBeNull();
  });

  it("an Administrator can create an action as themselves", async () => {
    const fetchMock = mockFetch({ post: () => res(201, action(5)) });
    const card = await openCreateForm(ADMIN);
    expect(within(card).getByText("Alex Admin")).toBeTruthy();
    fireEvent.change(within(card).getByLabelText(/^Description/), { target: { value: "Swapped cable" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(writes(fetchMock, "POST")).toHaveLength(1));
    expect(sentBody(writes(fetchMock, "POST")[0]).description).toBe("Swapped cable");
  });
});
