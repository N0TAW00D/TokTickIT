import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { StaffTicketDetailScreen } from "../../src/screens/StaffTicketDetailScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";

// Lab 4 ticket workflow on the IT Staff Ticket Detail (ui-spec.md §6,
// api-spec.md §3): permitted-transition list, version-guarded writes,
// resolution checklist / RESOLUTION_BLOCKED callout, STALE_UPDATE callout and
// the Status history card. The Actions Taken card itself is Issue #96; here
// the screen only reads `GET …/actions-taken` to compute the checklist.

const API = "http://localhost:3000";
const TICKET_ID = 21;
const URLS = {
  ticket: `${API}/api/tickets/${TICKET_ID}`,
  status: `${API}/api/tickets/${TICKET_ID}/status`,
  owner: `${API}/api/tickets/${TICKET_ID}/owner`,
  priority: `${API}/api/tickets/${TICKET_ID}/it-priority`,
  history: `${API}/api/tickets/${TICKET_ID}/status-history`,
  actions: `${API}/api/tickets/${TICKET_ID}/actions-taken`,
  comments: `${API}/api/tickets/${TICKET_ID}/comments`,
  notes: `${API}/api/tickets/${TICKET_ID}/notes`,
  assignable: `${API}/api/staff/assignable-users`,
};

const ALL_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
] as const;

const LABEL: Record<string, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

// specification.md §5.1, written out independently of the screen's own table.
const PERMITTED: Record<string, string[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CANCELLED: [],
};

function ticketBody(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    ticketNumber: "TKT-2026-000021",
    requester: { id: 7, name: "Jennifer Anderson", email: "j@example.edu" },
    category: { id: 4, name: "Network" },
    relatedSystem: { id: 7, name: "Corporate Laptop" },
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    status: "OPEN",
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

function action(id: number, status: string) {
  return {
    id,
    ticketId: TICKET_ID,
    actionAt: "2026-10-01T03:00:00.000Z",
    description: `Action ${id}`,
    result: status === "COMPLETED" ? "Done" : null,
    status,
    version: 1,
  };
}

interface Handlers {
  ticket?: () => Promise<Response>;
  history?: () => Promise<Response>;
  actions?: () => Promise<Response>;
  patchStatus?: (init: RequestInit) => Promise<Response>;
  patchOwner?: (init: RequestInit) => Promise<Response>;
  patchPriority?: (init: RequestInit) => Promise<Response>;
}

function mockFetch(h: Handlers = {}) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === URLS.assignable) return res(200, []);
    if (input === URLS.status && init?.method === "PATCH") {
      return (h.patchStatus ?? (() => res(200, ticketBody())))(init);
    }
    if (input === URLS.owner && init?.method === "PATCH") {
      return (h.patchOwner ?? (() => res(200, ticketBody())))(init);
    }
    if (input === URLS.priority && init?.method === "PATCH") {
      return (h.patchPriority ?? (() => res(200, ticketBody())))(init);
    }
    if (input === URLS.ticket && init?.method === undefined) {
      return (h.ticket ?? (() => res(200, ticketBody())))();
    }
    if (input === URLS.history) return (h.history ?? (() => res(200, [])))();
    if (input === URLS.actions) return (h.actions ?? (() => res(200, [])))();
    if (input === URLS.comments || input === URLS.notes) return res(200, []);
    return res(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof mockFetch>, url: string, method?: string) {
  return fetchMock.mock.calls.filter(
    ([u, init]: [string, RequestInit?]) =>
      u === url && (method === undefined ? init?.method === undefined : init?.method === method),
  );
}

function sentBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string);
}

const STAFF: AuthUser = {
  id: 9,
  name: "Jordan Lee",
  email: "jordan.lee@example.edu",
  role: "IT_STAFF",
  mustChangePassword: false,
};

function Bootstrap({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) setUser(STAFF);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

function renderScreen() {
  return render(
    <AuthProvider>
      <Bootstrap>
        <MemoryRouter initialEntries={[`/staff/tickets/${TICKET_ID}`]}>
          <Routes>
            <Route path="/staff/tickets/:id" element={<StaffTicketDetailScreen />} />
          </Routes>
        </MemoryRouter>
      </Bootstrap>
    </AuthProvider>,
  );
}

function statusSelect(): HTMLSelectElement {
  return screen.getByLabelText("Current Status") as HTMLSelectElement;
}

function optionLabels(select: HTMLSelectElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

function summaryBadge(): HTMLElement {
  const el = document.querySelector('[data-testid="summary-status"]');
  if (!el) throw new Error("summary status badge did not render");
  return el as HTMLElement;
}

function historyCard(): HTMLElement {
  return screen.getByRole("region", { name: "Status history" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Permitted transitions only", () => {
  it.each(ALL_STATUSES)(
    "C-22: from %s the status control lists the current status plus exactly the §5.1 targets",
    async (status) => {
      mockFetch({ ticket: () => res(200, ticketBody({ status })) });
      renderScreen();
      await screen.findByText("TKT-2026-000021");
      expect(optionLabels(statusSelect())).toEqual(
        [status, ...PERMITTED[status]].map((s) => LABEL[s]),
      );
    },
  );

  it("C-22: the Cancel confirm dialog warns that open actions will be cancelled", async () => {
    mockFetch();
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    fireEvent.change(statusSelect(), { target: { value: "CANCELLED" } });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Open actions on this ticket will be cancelled.");
  });

  it("C-22: a successful cancel re-reads the Actions list", async () => {
    let actionsReads = 0;
    const fetchMock = mockFetch({
      actions: () => {
        actionsReads += 1;
        return res(200, actionsReads === 1 ? [action(1, "PLANNED")] : [action(1, "CANCELLED")]);
      },
      patchStatus: () => res(200, ticketBody({ status: "CANCELLED", version: 4 })),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    await vi.waitFor(() => expect(calls(fetchMock, URLS.actions)).toHaveLength(1));

    fireEvent.change(statusSelect(), { target: { value: "CANCELLED" } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel ticket" }));

    await vi.waitFor(() => expect(calls(fetchMock, URLS.actions)).toHaveLength(2));
  });
});

describe("Success refreshes the summary", () => {
  it("C-23: after a status change the summary badge, permitted list and history card update without reload", async () => {
    let changed = false;
    const fetchMock = mockFetch({
      history: () =>
        res(
          200,
          changed
            ? [
                {
                  id: 1,
                  fromStatus: "OPEN",
                  toStatus: "IN_PROGRESS",
                  changedBy: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
                  changedAt: "2026-10-11T08:00:00.000Z",
                },
              ]
            : [],
        ),
      patchStatus: () => {
        changed = true;
        return res(200, ticketBody({ status: "IN_PROGRESS", version: 4 }));
      },
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    expect(summaryBadge()).toHaveTextContent("Open");
    expect(within(historyCard()).getByText("No status changes yet.")).toBeInTheDocument();

    fireEvent.change(statusSelect(), { target: { value: "IN_PROGRESS" } });

    await vi.waitFor(() => expect(summaryBadge()).toHaveTextContent("In Progress"));
    expect(optionLabels(statusSelect())).toEqual([
      "In Progress",
      "Waiting for Requester",
      "Resolved",
      "Cancelled",
    ]);
    await within(historyCard()).findByText("Jordan Lee", { exact: false });
    expect(within(historyCard()).queryByText("No status changes yet.")).toBeNull();
    expect(calls(fetchMock, URLS.ticket)).toHaveLength(1);
  });

  it("C-23: status, owner and IT Priority writes send the current version and adopt the returned one", async () => {
    let version = 3;
    const fetchMock = mockFetch({
      patchStatus: () => res(200, ticketBody({ status: "IN_PROGRESS", version: (version += 1) })),
      patchOwner: () => res(200, ticketBody({ status: "IN_PROGRESS", owner: null, version: (version += 1) })),
      patchPriority: () =>
        res(200, ticketBody({ status: "IN_PROGRESS", owner: null, itPriority: "LOW", version: (version += 1) })),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");

    fireEvent.change(statusSelect(), { target: { value: "IN_PROGRESS" } });
    await vi.waitFor(() => expect(summaryBadge()).toHaveTextContent("In Progress"));
    expect(sentBody(calls(fetchMock, URLS.status, "PATCH")[0])).toEqual({
      status: "IN_PROGRESS",
      version: 3,
    });

    fireEvent.change(screen.getByLabelText("Ticket Owner"), { target: { value: "unassigned" } });
    await vi.waitFor(() => expect(calls(fetchMock, URLS.owner, "PATCH")).toHaveLength(1));
    expect(sentBody(calls(fetchMock, URLS.owner, "PATCH")[0])).toEqual({
      ownerId: null,
      version: 4,
    });
    await vi.waitFor(() =>
      expect((screen.getByLabelText("Ticket Owner") as HTMLSelectElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    await vi.waitFor(() => expect(calls(fetchMock, URLS.priority, "PATCH")).toHaveLength(1));
    expect(sentBody(calls(fetchMock, URLS.priority, "PATCH")[0])).toEqual({
      itPriority: "LOW",
      version: 5,
    });
  });
});

describe("Resolution checklist and blocked callout", () => {
  it("C-24: the checklist marks each condition from the loaded owner and Actions", async () => {
    mockFetch({
      ticket: () => res(200, ticketBody({ owner: null })),
      actions: () => res(200, [action(1, "PLANNED"), action(2, "IN_PROGRESS"), action(3, "CANCELLED")]),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    const list = await screen.findByRole("list", { name: "Resolution checklist" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(/✗.*Ticket has an owner/);
    expect(items[1]).toMatch(/✗.*At least one action is completed/);
    expect(items[2]).toMatch(/✗.*No action is planned or in progress \(2 remaining\)/);
  });

  it("C-24: the checklist shows all conditions met when owner, a completed Action and no open Actions exist", async () => {
    mockFetch({ actions: () => res(200, [action(1, "COMPLETED"), action(2, "CANCELLED")]) });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    const list = await screen.findByRole("list", { name: "Resolution checklist" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(/✓.*Ticket has an owner/);
    expect(items[1]).toMatch(/✓.*At least one action is completed/);
    expect(items[2]).toMatch(/✓.*No action is planned or in progress/);
  });

  it("C-24: RESOLUTION_BLOCKED shows the returned reasons in an alert and leaves the status unchanged", async () => {
    mockFetch({
      patchStatus: () =>
        res(409, {
          error: "RESOLUTION_BLOCKED",
          message: "This ticket can't be resolved yet.",
          reasons: [
            { code: "NO_COMPLETED_ACTION", message: "Complete at least one Action Taken." },
            { code: "OPEN_ACTIONS_REMAIN", message: "2 Actions Taken are still Planned or In Progress.", count: 2 },
          ],
        }),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    fireEvent.change(statusSelect(), { target: { value: "RESOLVED" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This ticket can't be resolved yet.");
    const reasons = within(alert).getAllByRole("listitem").map((li) => li.textContent);
    expect(reasons).toEqual([
      "Complete at least one Action Taken.",
      "2 Actions Taken are still Planned or In Progress.",
    ]);
    expect(statusSelect().value).toBe("OPEN");
    expect(summaryBadge()).toHaveTextContent("Open");
    expect(within(alert).getByRole("link", { name: /Actions Taken/ })).toBeInTheDocument();
  });

  it("C-24: closing with open Actions shows the callout worded 'closed yet' with only the open-actions reason", async () => {
    mockFetch({
      ticket: () => res(200, ticketBody({ status: "RESOLVED" })),
      patchStatus: () =>
        res(409, {
          error: "RESOLUTION_BLOCKED",
          message: "This ticket can't be closed yet.",
          reasons: [
            { code: "OPEN_ACTIONS_REMAIN", message: "1 Action Taken is still Planned or In Progress.", count: 1 },
          ],
        }),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    fireEvent.change(statusSelect(), { target: { value: "CLOSED" } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close ticket" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This ticket can't be closed yet.");
    expect(within(alert).getAllByRole("listitem")).toHaveLength(1);
    expect(alert).toHaveTextContent("1 Action Taken is still Planned or In Progress.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(statusSelect().value).toBe("RESOLVED");
  });
});

describe("Stale Ticket write", () => {
  it("C-25: STALE_UPDATE on status shows the callout, keeps the attempted value and Refresh loads the current Ticket", async () => {
    let reads = 0;
    const fetchMock = mockFetch({
      ticket: () => {
        reads += 1;
        return res(200, reads === 1 ? ticketBody() : ticketBody({ status: "WAITING_FOR_REQUESTER", version: 9 }));
      },
      patchStatus: () =>
        res(409, {
          error: "STALE_UPDATE",
          message: "This record was changed by someone else.",
          current: ticketBody({ status: "WAITING_FOR_REQUESTER", version: 9 }),
        }),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    fireEvent.change(statusSelect(), { target: { value: "IN_PROGRESS" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This ticket was changed by someone else. Review its current state.");
    expect(statusSelect().value).toBe("IN_PROGRESS");
    expect(screen.getByText("Current: Waiting for Requester")).toBeInTheDocument();
    expect(calls(fetchMock, URLS.status, "PATCH")).toHaveLength(1);

    fireEvent.click(within(alert).getByRole("button", { name: "Refresh" }));
    await vi.waitFor(() => expect(statusSelect().value).toBe("WAITING_FOR_REQUESTER"));
    expect(calls(fetchMock, URLS.ticket)).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/^Current: /)).toBeNull();
    // Refresh never resubmits the attempted change.
    expect(calls(fetchMock, URLS.status, "PATCH")).toHaveLength(1);
  });

  it("C-25: STALE_UPDATE on a confirm-dialog destination keeps the attempted status too", async () => {
    mockFetch({
      patchStatus: () =>
        res(409, { error: "STALE_UPDATE", current: ticketBody({ status: "WAITING_FOR_REQUESTER", version: 9 }) }),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    fireEvent.change(statusSelect(), { target: { value: "CANCELLED" } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel ticket" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(statusSelect().value).toBe("CANCELLED");
    expect(screen.getByText("Current: Waiting for Requester")).toBeInTheDocument();
  });

  it("C-25: STALE_UPDATE on owner and on IT Priority shows the same callout", async () => {
    mockFetch({
      patchOwner: () => res(409, { error: "STALE_UPDATE", current: ticketBody({ version: 8 }) }),
      patchPriority: () => res(409, { error: "STALE_UPDATE", current: ticketBody({ version: 8 }) }),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");

    fireEvent.change(screen.getByLabelText("Ticket Owner"), { target: { value: "unassigned" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This ticket was changed by someone else. Review its current state.",
    );
    expect((screen.getByLabelText("Ticket Owner") as HTMLSelectElement).value).toBe("unassigned");
    expect(screen.getByText("Current owner: Jordan Lee")).toBeInTheDocument();
    cleanup();

    mockFetch({
      patchPriority: () => res(409, { error: "STALE_UPDATE", current: ticketBody({ version: 8 }) }),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This ticket was changed by someone else. Review its current state.",
    );
    expect(screen.getByRole("radio", { name: "Low" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "High" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Current: High")).toBeInTheDocument();
  });
});

describe("Status history card", () => {
  it("C-26: lists changes oldest first with from-to text and StatusBadges", async () => {
    mockFetch({
      history: () =>
        res(200, [
          {
            id: 1,
            fromStatus: "NEW",
            toStatus: "OPEN",
            changedBy: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
            changedAt: "2026-10-01T08:00:00.000Z",
          },
          {
            id: 2,
            fromStatus: "OPEN",
            toStatus: "IN_PROGRESS",
            changedBy: { id: 10, name: "Priya Natarajan", role: "IT_STAFF" },
            changedAt: "2026-10-02T08:00:00.000Z",
          },
        ]),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    const card = historyCard();
    const rows = await within(card).findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("New");
    expect(rows[0]).toHaveTextContent("Open");
    expect(rows[0]).toHaveTextContent("Jordan Lee");
    expect(rows[0].textContent).toMatch(/New.*→.*Open/);
    expect(rows[1].textContent).toMatch(/Open.*→.*In Progress/);
    expect(rows[1]).toHaveTextContent("Priya Natarajan");
    expect(rows[0].querySelectorAll(".zen-badge")).toHaveLength(2);
  });

  it("C-26: shows 'No status changes yet.' for an empty history", async () => {
    mockFetch();
    renderScreen();
    await screen.findByText("TKT-2026-000021");
    expect(await within(historyCard()).findByText("No status changes yet.")).toBeInTheDocument();
  });
});
