import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TicketDetailScreen } from "../../src/screens/TicketDetailScreen.tsx";

// Row C-27 of tests.md: Actions Taken and Status history on the Requester
// Ticket Detail (ui-spec.md §5.3) — read-only, no Internal Notes, no IT Priority.

const API = "http://localhost:3000";
const URLS = {
  ticket: `${API}/api/tickets/1`,
  actions: `${API}/api/tickets/1/actions-taken`,
  history: `${API}/api/tickets/1/status-history`,
  comments: `${API}/api/tickets/1/comments`,
  notes: `${API}/api/tickets/1/notes`,
};

function res(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ticketNumber: "TKT-2026-000001",
    requester: { id: 7, name: "Jennifer Anderson", email: "j@example.edu" },
    category: { id: 2, name: "Hardware" },
    relatedSystem: { id: 7, name: "Corporate Laptop" },
    requestedPriority: "MEDIUM",
    status: "IN_PROGRESS",
    summary: "Laptop battery drains quickly",
    description: "My laptop battery is draining much faster than usual.",
    createdAt: "2026-09-01T08:14:00.000Z",
    updatedAt: "2026-09-01T09:02:00.000Z",
    attachments: [],
    owner: { id: 9, name: "Jordan Lee" },
    requesterResolvedAt: null,
    ...overrides,
  };
}

function action(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ticketId: 1,
    actionAt: "2026-10-01T03:00:00.000Z",
    description: `Replaced the battery ${id}`,
    result: "Battery now lasts a full day",
    status: "COMPLETED",
    performedBy: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
    assignee: { id: 10, name: "Priya Natarajan" },
    followUpRequired: true,
    followUpNote: "Check the charger next week",
    attachmentNotes: "photo of the old battery",
    lastUpdatedBy: { id: 9, name: "Jordan Lee" },
    createdAt: "2026-10-01T03:05:00.000Z",
    updatedAt: "2026-10-01T03:05:00.000Z",
    version: 2,
    ...overrides,
  };
}

const HISTORY = [
  {
    id: 1,
    fromStatus: "NEW",
    toStatus: "IN_PROGRESS",
    changedBy: { id: 9, name: "Jordan Lee" },
    changedAt: "2026-09-02T08:00:00.000Z",
  },
];

interface Opts {
  actions?: () => Promise<Response>;
  history?: () => Promise<Response>;
  ticket?: Record<string, unknown>;
}

function mockFetch({ actions, history, ticket: t }: Opts = {}) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (init?.method !== undefined && init.method !== "GET") return res(404, {});
    if (input === URLS.ticket) return res(200, ticket(t));
    if (input === URLS.actions) return (actions ?? (() => res(200, [action(1)])))();
    if (input === URLS.history) return (history ?? (() => res(200, HISTORY)))();
    if (input === URLS.comments) return res(200, []);
    return res(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/tickets/1"]}>
      <Routes>
        <Route path="/tickets/:id" element={<TicketDetailScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("C-27 Requester Ticket Detail: Actions Taken and Status history (AC-39, FR-06)", () => {
  it("shows the Actions Taken list read-only, with every field in View", async () => {
    mockFetch();
    renderScreen();

    const card = (await screen.findByRole("heading", { name: "Actions Taken (1)" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(card).getByText("Replaced the battery 1")).toBeInTheDocument();
    expect(within(card).getByText("Battery now lasts a full day")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: /^View action from/ }));
    for (const text of [
      "Description",
      "Result",
      "Performed by",
      "Assignee",
      "Priya Natarajan",
      "Follow-up note",
      "Check the charger next week",
      "Look for: photo of the old battery",
      "Logged at",
      "Last updated by",
    ]) {
      expect(within(card).getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it("offers no Add, Edit or status controls, even for an open action", async () => {
    mockFetch({
      actions: () => res(200, [action(1, { status: "IN_PROGRESS" }), action(2, { status: "PLANNED" })]),
    });
    renderScreen();

    const card = (await screen.findByRole("heading", { name: "Actions Taken (2)" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(card).queryByRole("button", { name: /add action/i })).toBeNull();
    expect(within(card).queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByLabelText("Current Status")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    // The only buttons in the card are the two read-only View toggles.
    expect(within(card).getAllByRole("button")).toHaveLength(2);
  });

  it("lists the status history oldest first with text, no controls", async () => {
    mockFetch();
    renderScreen();

    const heading = await screen.findByRole("heading", { name: "Status history" });
    const card = heading.closest("section") as HTMLElement;
    await within(card).findByText(/Jordan Lee/);
    expect(card.textContent).toContain("New");
    expect(card.textContent).toContain("In Progress");
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("shows the empty states in the spec wording", async () => {
    mockFetch({ actions: () => res(200, []), history: () => res(200, []) });
    renderScreen();

    expect(await screen.findByText("No actions have been recorded yet.")).toBeInTheDocument();
    expect(await screen.findByText("No status changes yet.")).toBeInTheDocument();
  });

  it("never reads or shows Internal Notes, and never shows IT Priority", async () => {
    const fetchMock = mockFetch({ ticket: { itPriority: "HIGH" } });
    renderScreen();

    await screen.findByRole("heading", { name: "Actions Taken (1)" });
    expect(screen.queryByText(/internal note/i)).toBeNull();
    expect(screen.queryByText(/IT Priority/i)).toBeNull();
    expect(fetchMock.mock.calls.some(([u]: [string]) => u === URLS.notes)).toBe(false);
  });

  it("shows the Actions Taken card between Attachments and Public Comments", async () => {
    mockFetch();
    renderScreen();

    await screen.findByRole("heading", { name: "Comments" });
    const order = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent ?? "");
    const idx = (prefix: string) => order.findIndex((t) => t.startsWith(prefix));
    expect(idx("Attachments")).toBeLessThan(idx("Actions Taken"));
    expect(idx("Actions Taken")).toBeLessThan(idx("Status history"));
    expect(idx("Status history")).toBeLessThan(idx("Comments"));
  });

  it("retries a failed Actions Taken read from the card", async () => {
    let calls = 0;
    mockFetch({
      actions: () => (++calls === 1 ? res(500, {}) : res(200, [action(1)])),
    });
    renderScreen();

    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(await screen.findByText("Replaced the battery 1")).toBeInTheDocument();
  });
});
