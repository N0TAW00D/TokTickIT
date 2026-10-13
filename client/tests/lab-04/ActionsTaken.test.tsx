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

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function form(card: HTMLElement, name = "Add action"): HTMLElement {
  return within(card).getByRole("form", { name });
}

function typeInto(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

/** The `.zen-field` wrapper, so a message can be asserted to sit directly under its own control. */
function fieldOf(control: HTMLElement): HTMLElement {
  return control.closest(".zen-field") as HTMLElement;
}

function errorUnder(control: HTMLElement): string | undefined {
  return fieldOf(control).querySelector('[role="alert"]')?.textContent ?? undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("C-11 Create form", () => {
  it("has every field; Performed by is static text; date defaults to now; status offers three values", async () => {
    mockFetch();
    const card = await openCreateForm();
    const f = form(card);

    const date = within(f).getByLabelText(/^Action date\/time/) as HTMLInputElement;
    expect(date.type).toBe("datetime-local");
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // 07:00 offset: the default is "now" on the Bangkok wall clock.
    const asIso = new Date(`${date.value}:00+07:00`).getTime();
    expect(Math.abs(asIso - Date.now())).toBeLessThan(120_000);

    const performer = within(f).getByText("Jordan Lee");
    expect(performer.closest("input, textarea, select")).toBeNull();
    expect(within(f).getByText("Recorded automatically.")).toBeTruthy();

    const status = within(f).getByLabelText(/^Status/) as HTMLSelectElement;
    expect(within(status).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Planned",
      "In progress",
      "Completed",
    ]);
    expect(status.value).toBe("PLANNED");

    expect(within(f).getByLabelText("Assignee")).toBeTruthy();
    expect(within(f).getByLabelText(/^Description/)).toBeTruthy();
    expect(within(f).getByLabelText(/^Result/)).toBeTruthy();
    expect(within(f).getByLabelText(/^Follow-up required/)).toBeTruthy();
    expect(within(f).getByLabelText(/^Attachment notes/)).toBeTruthy();
    expect(within(f).getByText(/This does not upload a file/)).toBeTruthy();
    expect(within(f).getByRole("button", { name: "Save action" })).toBeTruthy();
    expect(within(f).getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("marks Action date/time, Description and Status required, and Result only when Completed", async () => {
    mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    const required = (re: RegExp) =>
      within(f).getByLabelText(re).getAttribute("aria-required");
    expect(required(/^Action date\/time/)).toBe("true");
    expect(required(/^Description/)).toBe("true");
    expect(required(/^Status/)).toBe("true");
    expect(required(/^Result/)).toBeNull();
    expect(fieldOf(within(f).getByLabelText(/^Result/)).textContent).not.toContain("*");

    typeInto(within(f).getByLabelText(/^Status/), "COMPLETED");
    expect(required(/^Result/)).toBe("true");
    expect(fieldOf(within(f).getByLabelText(/^Result/)).textContent).toContain("*");

    typeInto(within(f).getByLabelText(/^Status/), "IN_PROGRESS");
    expect(required(/^Result/)).toBeNull();
  });

  it("moves focus to the first field when opened and offers active staff as assignees", async () => {
    mockFetch({ assignable: [{ id: 8, name: "Carlos Mendes", role: "IT_STAFF" }] });
    const card = await openCreateForm();
    const f = form(card);
    expect(document.activeElement).toBe(within(f).getByLabelText(/^Action date\/time/));
    const options = within(within(f).getByLabelText("Assignee")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Unassigned", "Carlos Mendes"]);
  });

  it("creates the action, sends a UUID clientRequestId and no server-owned fields, then shows the row", async () => {
    let created = false;
    const fetchMock = mockFetch({
      actions: () => res(200, created ? [action(99, { description: "Reset VPN" })] : []),
      post: () => {
        created = true;
        return res(201, action(99, { description: "Reset VPN" }));
      },
    });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "  Reset VPN  ");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));

    expect(await within(card).findByText("Action saved.")).toBeTruthy();
    expect(within(card).getByRole("status").textContent).toContain("Action saved.");
    const body = sentBody(writes(fetchMock, "POST")[0]);
    expect(body.description).toBe("Reset VPN");
    expect(body.status).toBe("PLANNED");
    expect(body.followUpRequired).toBe(false);
    expect(body.clientRequestId).toMatch(UUID);
    expect(typeof body.actionAt).toBe("string");
    expect(body).not.toHaveProperty("performedBy");
    expect(body).not.toHaveProperty("result");
    expect(await within(card).findByText("Reset VPN")).toBeTruthy();
    expect(within(card).queryByRole("form")).toBeNull();
    expect(listReads(fetchMock).length).toBe(2);
  });

  it("clears the saved notice after four seconds", async () => {
    mockFetch();
    const card = await openCreateForm();
    typeInto(within(form(card)).getByLabelText(/^Description/), "X");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(form(card)).getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(within(card).getByText("Action saved.")).toBeTruthy());
    vi.advanceTimersByTime(4100);
    await waitFor(() => expect(within(card).queryByText("Action saved.")).toBeNull());
  });

  it("refreshes the resolution checklist after an action is saved", async () => {
    let completed = false;
    mockFetch({
      ticket: () => res(200, ticketBody({ status: "IN_PROGRESS" })),
      actions: () => res(200, completed ? [action(99, { status: "COMPLETED", result: "Done" })] : []),
      post: () => {
        completed = true;
        return res(201, action(99, { status: "COMPLETED", result: "Done" }));
      },
    });
    const card = await openCreateForm();
    const checklist = () => screen.getByRole("list", { name: "Resolution checklist" });
    expect(checklist().textContent).toContain("Not met: At least one action is completed");
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Fixed it");
    typeInto(within(f).getByLabelText(/^Status/), "COMPLETED");
    typeInto(within(f).getByLabelText(/^Result/), "Done");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    await waitFor(() =>
      expect(checklist().textContent).toContain("Met: At least one action is completed"),
    );
  });

  it("Cancel closes the form without a request and returns focus to Add action", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    fireEvent.click(within(form(card)).getByRole("button", { name: "Cancel" }));
    expect(within(card).queryByRole("form")).toBeNull();
    expect(writes(fetchMock, "POST")).toHaveLength(0);
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Add action" }));
  });

  it("only offers one open form: Edit is disabled while the create form is open", async () => {
    mockFetch({ actions: () => res(200, [action(1)]) });
    const card = await openCreateForm();
    expect((within(card).getByRole("button", { name: /^Edit action/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("C-12 Validation placement", () => {
  it("shows an empty description under the field, marks it invalid, focuses it and sends nothing", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const description = within(f).getByLabelText(/^Description/);
    expect(errorUnder(description)).toBe("Enter a description.");
    expect(description.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(description);
    expect(writes(fetchMock, "POST")).toHaveLength(0);
  });

  it("rejects a future time on a non-planned action, and allows it on a planned one", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Do it");
    typeInto(within(f).getByLabelText(/^Action date\/time/), "2099-01-01T10:00");
    typeInto(within(f).getByLabelText(/^Status/), "IN_PROGRESS");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const date = within(f).getByLabelText(/^Action date\/time/);
    expect(errorUnder(date)).toBe("A future time is allowed only for a planned action.");
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(date);
    expect(writes(fetchMock, "POST")).toHaveLength(0);

    typeInto(within(f).getByLabelText(/^Status/), "PLANNED");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(writes(fetchMock, "POST")).toHaveLength(1));
    expect(sentBody(writes(fetchMock, "POST")[0]).actionAt).toBe("2099-01-01T03:00:00.000Z");
  });

  it("rejects a time before the ticket was created", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Do it");
    typeInto(within(f).getByLabelText(/^Action date\/time/), "2020-01-01T10:00");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    expect(errorUnder(within(f).getByLabelText(/^Action date\/time/))).toMatch(/earlier than the ticket/);
    expect(writes(fetchMock, "POST")).toHaveLength(0);
  });

  it("flags over-long description, result and attachment notes each under its own field, focusing the first", async () => {
    mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "d".repeat(2001));
    typeInto(within(f).getByLabelText(/^Result/), "r".repeat(2001));
    typeInto(within(f).getByLabelText(/^Attachment notes/), "a".repeat(501));
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    expect(errorUnder(within(f).getByLabelText(/^Description/))).toMatch(/2000 characters or fewer/);
    expect(errorUnder(within(f).getByLabelText(/^Result/))).toMatch(/2000 characters or fewer/);
    expect(errorUnder(within(f).getByLabelText(/^Attachment notes/))).toMatch(/500 characters or fewer/);
    expect(document.activeElement).toBe(within(f).getByLabelText(/^Description/));
  });

  it("shows live character counters", async () => {
    mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    expect(within(f).getAllByText("0/2000")).toHaveLength(2);
    expect(within(f).getByText("0/500")).toBeTruthy();
    typeInto(within(f).getByLabelText(/^Description/), "hello");
    expect(within(f).getByText("5/2000")).toBeTruthy();
  });

  it("maps server fields[] from a 400 to the matching controls and keeps the values", async () => {
    mockFetch({
      post: () =>
        res(400, {
          error: "VALIDATION_FAILED",
          fields: [{ field: "description", message: "Description is required." }],
        }),
    });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "typed text");
    typeInto(within(f).getByLabelText(/^Attachment notes/), "see log");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    await waitFor(() =>
      expect(errorUnder(within(f).getByLabelText(/^Description/))).toBe("Description is required."),
    );
    expect(document.activeElement).toBe(within(f).getByLabelText(/^Description/));
    expect((within(f).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("typed text");
    expect((within(f).getByLabelText(/^Attachment notes/) as HTMLTextAreaElement).value).toBe("see log");
  });
});

describe("C-13 Follow-up note behavior", () => {
  it("shows the note only while the box is on, requires it, focuses it, and clears it when switched off", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    const box = within(f).getByLabelText(/^Follow-up required/) as HTMLInputElement;
    expect(within(f).queryByLabelText(/^Follow-up note/)).toBeNull();
    expect(box.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(box);
    const note = within(f).getByLabelText(/^Follow-up note/) as HTMLTextAreaElement;
    expect(note.getAttribute("aria-required")).toBe("true");
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(box.getAttribute("aria-controls")).toBe(note.id);
    expect(document.activeElement).toBe(note);
    expect(within(f).getByText("0/1000")).toBeTruthy();

    typeInto(within(f).getByLabelText(/^Description/), "Needs follow-up");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    expect(errorUnder(note)).toBe("Enter a follow-up note.");
    expect(writes(fetchMock, "POST")).toHaveLength(0);

    typeInto(note, "Check Friday");
    fireEvent.click(box);
    expect(within(f).queryByLabelText(/^Follow-up note/)).toBeNull();
    fireEvent.click(box);
    expect((within(f).getByLabelText(/^Follow-up note/) as HTMLTextAreaElement).value).toBe("");
  });

  it("sends the note with the flag, and omits the note when the flag is off", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "A");
    fireEvent.click(within(f).getByLabelText(/^Follow-up required/));
    typeInto(within(f).getByLabelText(/^Follow-up note/), "Check Friday");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(writes(fetchMock, "POST")).toHaveLength(1));
    const body = sentBody(writes(fetchMock, "POST")[0]);
    expect(body.followUpRequired).toBe(true);
    expect(body.followUpNote).toBe("Check Friday");
  });
});

describe("C-29 Result required only for Completed", () => {
  it("Completed with an empty result shows the message below Result and keeps the values", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Replaced switch");
    typeInto(within(f).getByLabelText(/^Status/), "COMPLETED");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const result = within(f).getByLabelText(/^Result/);
    expect(errorUnder(result)).toBe("Enter the result to complete this action.");
    expect(result.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(result);
    expect((within(f).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("Replaced switch");
    expect((within(f).getByLabelText(/^Status/) as HTMLSelectElement).value).toBe("COMPLETED");
    expect(writes(fetchMock, "POST")).toHaveLength(0);
  });

  it.each(["PLANNED", "IN_PROGRESS"])("%s saves without a result", async (status) => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Something");
    typeInto(within(f).getByLabelText(/^Status/), status);
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(writes(fetchMock, "POST")).toHaveLength(1));
    const body = sentBody(writes(fetchMock, "POST")[0]);
    expect(body.status).toBe(status);
    expect(body).not.toHaveProperty("result");
  });

  it("Completed with a result is sent", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Something");
    typeInto(within(f).getByLabelText(/^Status/), "COMPLETED");
    typeInto(within(f).getByLabelText(/^Result/), " Works now ");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(writes(fetchMock, "POST")).toHaveLength(1));
    const body = sentBody(writes(fetchMock, "POST")[0]);
    expect(body.status).toBe("COMPLETED");
    expect(body.result).toBe("Works now");
  });
});

describe("C-16 Duplicate submit", () => {
  it("a double click sends one request and disables the control while pending", async () => {
    let resolvePost!: (r: Response) => void;
    const fetchMock = mockFetch({
      post: () => new Promise<Response>((resolve) => (resolvePost = resolve)),
    });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Once only");
    const save = within(f).getByRole("button", { name: "Save action" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(writes(fetchMock, "POST")).toHaveLength(1);
    const pending = within(f).getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    resolvePost(await res(201, action(99)));
    await waitFor(() => expect(within(card).getByText("Action saved.")).toBeTruthy());
    expect(writes(fetchMock, "POST")).toHaveLength(1);
  });

  it("Retry after a network failure reuses the same clientRequestId and the same body", async () => {
    let attempt = 0;
    const fetchMock = mockFetch({
      post: () => {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new TypeError("network down")) : res(200, action(99));
      },
    });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Retry me");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const alert = await within(f).findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(writes(fetchMock, "POST")).toHaveLength(2));
    const [first, second] = writes(fetchMock, "POST").map(sentBody);
    expect(first.clientRequestId).toMatch(UUID);
    expect(second.clientRequestId).toBe(first.clientRequestId);
    expect(second.description).toBe("Retry me");
    await waitFor(() => expect(within(card).getByText("Action saved.")).toBeTruthy());
  });

  it("a new form gets a new clientRequestId", async () => {
    const fetchMock = mockFetch();
    const card = await openCreateForm();
    typeInto(within(form(card)).getByLabelText(/^Description/), "One");
    fireEvent.click(within(form(card)).getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(writes(fetchMock, "POST")).toHaveLength(1));
    await within(card).findByText("Action saved.");
    fireEvent.click(within(card).getByRole("button", { name: "Add action" }));
    typeInto(within(form(card)).getByLabelText(/^Description/), "Two");
    fireEvent.click(within(form(card)).getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(writes(fetchMock, "POST")).toHaveLength(2));
    const [a, b] = writes(fetchMock, "POST").map(sentBody);
    expect(a.clientRequestId).not.toBe(b.clientRequestId);
  });
});

describe("C-14 Entered data survives failures", () => {
  it("keeps typed values and shows the safe failure beside them on a network failure", async () => {
    mockFetch({ post: () => Promise.reject(new TypeError("network down")) });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Do not lose me");
    typeInto(within(f).getByLabelText(/^Result/), "Partial result");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const alert = await within(f).findByRole("alert");
    expect(alert.textContent).toContain("Something went wrong. Try again.");
    expect(alert.textContent).not.toMatch(/network down|TypeError/);
    expect((within(f).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("Do not lose me");
    expect((within(f).getByLabelText(/^Result/) as HTMLTextAreaElement).value).toBe("Partial result");
    expect((within(f).getByRole("button", { name: "Save action" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps typed values and shows the safe failure on a 500", async () => {
    mockFetch({ post: () => res(500, { error: "INTERNAL", message: "stack trace here" }) });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Still here");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const alert = await within(f).findByRole("alert");
    expect(alert.textContent).not.toContain("stack trace");
    expect((within(f).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("Still here");
  });
});

describe("C-19 Invalid assignee", () => {
  it("renders the message on the Assignee field and keeps the entered values", async () => {
    const fetchMock = mockFetch({
      assignable: [{ id: 8, name: "Carlos Mendes", role: "IT_STAFF" }],
      post: () => res(409, { error: "INVALID_ASSIGNEE", message: "no" }),
    });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Hand over");
    typeInto(within(f).getByLabelText("Assignee"), "8");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const assignee = within(f).getByLabelText("Assignee") as HTMLSelectElement;
    await waitFor(() =>
      expect(errorUnder(assignee)).toBe(
        "That person can't be assigned. Choose an active IT Staff member.",
      ),
    );
    expect(assignee.value).toBe("8");
    expect(assignee.getAttribute("aria-invalid")).toBe("true");
    expect((within(f).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("Hand over");
    expect(sentBody(writes(fetchMock, "POST")[0]).assigneeId).toBe(8);
  });
});

describe("C-30 Not-found and forbidden callouts", () => {
  it("404 shows the no-longer-exists callout with a Ticket Queue link and keeps the values", async () => {
    mockFetch({ post: () => res(404, { error: "NOT_FOUND" }) });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Orphan");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const alert = await within(f).findByRole("alert");
    expect(alert.textContent).toContain("This action or ticket no longer exists.");
    expect(within(alert).getByRole("link", { name: "Ticket Queue" }).getAttribute("href")).toBe("/staff/tickets");
    expect((within(f).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("Orphan");
  });

  it("403 shows the permission callout and keeps the values", async () => {
    mockFetch({ post: () => res(403, { error: "FORBIDDEN" }) });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Not allowed");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const alert = await within(f).findByRole("alert");
    expect(alert.textContent).toContain("You don't have permission to change Actions Taken.");
    expect((within(f).getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe("Not allowed");
  });
});

describe("Conflicts on create", () => {
  it("TICKET_CLOSED shows the closed callout, makes the form read-only and re-reads the ticket", async () => {
    let closed = false;
    const fetchMock = mockFetch({
      ticket: () => res(200, ticketBody({ status: closed ? "CLOSED" : "IN_PROGRESS" })),
      post: () => {
        closed = true;
        return res(409, { error: "TICKET_CLOSED" });
      },
    });
    const card = await openCreateForm();
    const f = form(card);
    typeInto(within(f).getByLabelText(/^Description/), "Too late");
    fireEvent.click(within(f).getByRole("button", { name: "Save action" }));
    const alert = await within(f).findByRole("alert");
    expect(alert.textContent).toContain("This ticket is closed.");
    const description = within(f).getByLabelText(/^Description/) as HTMLTextAreaElement;
    expect(description.value).toBe("Too late");
    expect(description.readOnly).toBe(true);
    expect(within(f).queryByRole("button", { name: "Save action" })).toBeNull();
    await waitFor(() =>
      expect(within(card).getByText("This ticket is closed. Actions Taken are read-only.")).toBeTruthy(),
    );
    expect(fetchMock.mock.calls.filter(([u]: [string]) => u === URLS.ticket).length).toBeGreaterThan(1);
  });

  it("IDEMPOTENCY_CONFLICT tells the user to reload before adding it again", async () => {
    mockFetch({ post: () => res(409, { error: "IDEMPOTENCY_CONFLICT" }) });
    const card = await openCreateForm();
    typeInto(within(form(card)).getByLabelText(/^Description/), "Dup");
    fireEvent.click(within(form(card)).getByRole("button", { name: "Save action" }));
    const alert = await within(form(card)).findByRole("alert");
    expect(alert.textContent).toMatch(/already saved/);
    expect(within(alert).getByRole("button", { name: "Reload actions" })).toBeTruthy();
  });
});
