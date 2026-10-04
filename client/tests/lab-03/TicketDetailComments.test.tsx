import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TicketDetailScreen } from "../../src/screens/TicketDetailScreen.tsx";

// Issue #70: Public Comments (MessageThread, ui-spec.md §7/§8) and
// "Problem Appears Resolved" (ui-spec.md §7) on Requester Ticket Detail.
// No dedicated tests.md C-xx row covers this screen's own half of either
// feature (C-13 is StaffTicketDetail's Notes-vs-Comments distinction,
// #71/#72's screen; E2E-08 covers the cross-role flow end-to-end) — this
// file closes that gap the same way other "no tests.md row" suites in this
// repo do (see e.g. MyTickets.test.tsx's "Clear filters" describe block).

const API_BASE_URL = "http://localhost:3000";
const TICKET_URL = `${API_BASE_URL}/api/tickets/1`;
const COMMENTS_URL = `${API_BASE_URL}/api/tickets/1/comments`;
const RESOLVED_URL = `${API_BASE_URL}/api/tickets/1/requester-resolved`;

function baseTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ticketNumber: "TKT-2026-000001",
    requester: { id: 7, name: "Jennifer Anderson", email: "jennifer.anderson@example.edu" },
    category: { id: 2, name: "Hardware" },
    relatedSystem: { id: 7, name: "Corporate Laptop" },
    requestedPriority: "MEDIUM",
    status: "NEW",
    summary: "Laptop battery drains quickly",
    description: "My laptop battery is draining much faster than usual.",
    createdAt: "2026-09-01T08:14:00.000Z",
    updatedAt: "2026-09-01T09:02:00.000Z",
    attachments: [],
    owner: null,
    requesterResolvedAt: null,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

interface MockOptions {
  ticket?: Record<string, unknown>;
  comments?: unknown[];
  postComment?: (init: RequestInit) => Promise<Response>;
  resolve?: (init: RequestInit) => Promise<Response>;
}

function mockFetch({ ticket = baseTicket(), comments = [], postComment, resolve }: MockOptions = {}) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === COMMENTS_URL && (!init || init.method === undefined)) {
      return jsonResponse(200, comments);
    }
    if (input === COMMENTS_URL && init?.method === "POST") {
      return (postComment ?? (() => jsonResponse(201, {})))(init);
    }
    if (input === RESOLVED_URL && init?.method === "POST") {
      return (resolve ?? (() => jsonResponse(204, {})))(init);
    }
    if (input === TICKET_URL) {
      return jsonResponse(200, ticket);
    }
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/tickets/1"]}>
      <Routes>
        <Route path="/tickets/:id" element={<TicketDetailScreen />} />
        <Route path="/tickets" element={<h1>My Tickets</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Ticket Owner row (ui-spec.md §7)", () => {
  it('shows "Unassigned" when the ticket has no owner', async () => {
    mockFetch({ ticket: baseTicket({ owner: null }) });
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows the owner's name when assigned", async () => {
    mockFetch({ ticket: baseTicket({ owner: { id: 3, name: "Priya Natarajan" } }) });
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    expect(screen.getByText("Priya Natarajan")).toBeInTheDocument();
  });

  it("never shows an IT Priority field (api-spec.md §9: never sent to a Requester)", async () => {
    mockFetch();
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    expect(screen.queryByText(/it priority/i)).not.toBeInTheDocument();
  });
});

describe("Public Comments thread (ui-spec.md §8, variant=public)", () => {
  it('renders the "Comments" heading with no private badge, and each entry\'s author, role and body', async () => {
    mockFetch({
      comments: [
        {
          id: 1,
          body: "I restarted the laptop and it still fails.",
          createdAt: "2026-09-01T08:41:03.000Z",
          author: { id: 7, name: "Jennifer Anderson", role: "REQUESTER" },
        },
        {
          id: 2,
          body: "Thanks — try a different charger.",
          createdAt: "2026-09-01T09:10:00.000Z",
          author: { id: 3, name: "Priya Natarajan", role: "IT_STAFF" },
        },
      ],
    });
    renderScreen();

    await screen.findByText("TKT-2026-000001");

    const heading = await screen.findByRole("heading", { name: "Comments" });
    expect(heading).toBeInTheDocument();
    expect(screen.queryByText(/private/i)).not.toBeInTheDocument();

    expect(screen.getByText("I restarted the laptop and it still fails.")).toBeInTheDocument();
    expect(screen.getByText("Thanks — try a different charger.")).toBeInTheDocument();
    expect(screen.getAllByText("Jennifer Anderson").length).toBeGreaterThan(0);
    expect(screen.getByText("Priya Natarajan")).toBeInTheDocument();
    const thread = heading.closest(".zen-message-thread") as HTMLElement;
    expect(within(thread).getByText("Requester")).toBeInTheDocument();
    expect(within(thread).getByText("IT Staff")).toBeInTheDocument();

    // Entries render in the order the server returned them (oldest first,
    // newest last) — never reordered client-side.
    const bodies = screen.getAllByText(/restarted|different charger/);
    expect(bodies[0]).toHaveTextContent("I restarted the laptop and it still fails.");
    expect(bodies[1]).toHaveTextContent("Thanks — try a different charger.");
  });

  it("shows an empty-thread message when there are no comments yet", async () => {
    mockFetch({ comments: [] });
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument();
  });

  it("posting a comment calls the API with credentials and appends the server's entry to the thread", async () => {
    const created = {
      id: 9,
      body: "Still broken after the restart.",
      createdAt: "2026-09-02T10:00:00.000Z",
      author: { id: 7, name: "Jennifer Anderson", role: "REQUESTER" },
    };
    const fetchMock = mockFetch({
      comments: [],
      postComment: () => jsonResponse(201, created),
    });
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    await screen.findByText(/no comments yet/i);

    const textarea = screen.getByLabelText(/add a comment/i);
    fireEvent.change(textarea, { target: { value: "Still broken after the restart." } });
    fireEvent.click(screen.getByRole("button", { name: /post comment/i }));

    expect(await screen.findByText("Still broken after the restart.")).toBeInTheDocument();
    expect(screen.queryByText(/no comments yet/i)).not.toBeInTheDocument();
    expect(textarea).toHaveValue("");

    const postCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit?]) => url === COMMENTS_URL && init?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const [, init] = postCall as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ body: "Still broken after the restart." });
  });

  it("blocks a whitespace-only submission client-side — no request fired, a field error shown", async () => {
    const fetchMock = mockFetch({ comments: [] });
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    await screen.findByText(/no comments yet/i);

    const textarea = screen.getByLabelText(/add a comment/i);
    fireEvent.change(textarea, { target: { value: "   \n\t  " } });
    fireEvent.click(screen.getByRole("button", { name: /post comment/i }));

    expect(await screen.findByText(/enter a message/i)).toBeInTheDocument();
    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit?]) => url === COMMENTS_URL && init?.method === "POST",
    );
    expect(postCalls).toHaveLength(0);
  });

  it("shows a live character counter once the body reaches 1800 characters, not before", async () => {
    mockFetch({ comments: [] });
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    await screen.findByText(/no comments yet/i);

    const textarea = screen.getByLabelText(/add a comment/i);

    fireEvent.change(textarea, { target: { value: "a".repeat(1799) } });
    expect(screen.queryByText("1799/2000")).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "a".repeat(1800) } });
    expect(screen.getByText("1800/2000")).toBeInTheDocument();
  });
});

describe('"Problem Appears Resolved" (ui-spec.md §7)', () => {
  it("shows the button while the status is not Resolved, Closed or Cancelled", async () => {
    mockFetch({ ticket: baseTicket({ status: "OPEN" }) });
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    expect(
      screen.getByRole("button", { name: /problem appears resolved/i }),
    ).toBeInTheDocument();
  });

  it.each(["RESOLVED", "CLOSED", "CANCELLED"])(
    "hides the button once the status is %s",
    async (status) => {
      mockFetch({ ticket: baseTicket({ status }) });
      renderScreen();

      await screen.findByText("TKT-2026-000001");
      expect(
        screen.queryByRole("button", { name: /problem appears resolved/i }),
      ).not.toBeInTheDocument();
    },
  );

  it("Cancel closes the confirm dialog without calling the API", async () => {
    const fetchMock = mockFetch({ ticket: baseTicket({ status: "OPEN" }) });
    renderScreen();
    await screen.findByText("TKT-2026-000001");

    fireEvent.click(screen.getByRole("button", { name: /problem appears resolved/i }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Let IT Staff know this looks resolved? They'll confirm before the ticket is closed.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const resolveCalls = fetchMock.mock.calls.filter(([url]: [string]) => url === RESOLVED_URL);
    expect(resolveCalls).toHaveLength(0);
  });

  it("confirming posts the indication, closes the dialog, and replaces the button with the read-only note — the status badge does not change", async () => {
    const fetchMock = mockFetch({ ticket: baseTicket({ status: "OPEN" }) });
    renderScreen();
    await screen.findByText("TKT-2026-000001");

    fireEvent.click(screen.getByRole("button", { name: /problem appears resolved/i }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /yes, let it staff know/i }));

    expect(await screen.findByText(/you reported this looks resolved on/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /problem appears resolved/i }),
    ).not.toBeInTheDocument();
    // BR-26: status is unchanged.
    expect(screen.getByText("Open")).toBeInTheDocument();

    const resolveCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit?]) => url === RESOLVED_URL && init?.method === "POST",
    );
    expect(resolveCall).toBeDefined();
    const [, init] = resolveCall as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });

  it("shows the read-only note immediately on load when the ticket was already resolved in an earlier visit", async () => {
    mockFetch({
      ticket: baseTicket({ status: "OPEN", requesterResolvedAt: "2026-09-01T10:00:00.000Z" }),
    });
    renderScreen();

    await screen.findByText("TKT-2026-000001");
    expect(await screen.findByText(/you reported this looks resolved on/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /problem appears resolved/i }),
    ).not.toBeInTheDocument();
  });

  it("a 409 conflict closes the dialog and shows the exact conflict banner with a Refresh action; Refresh re-fetches the ticket", async () => {
    const fetchMock = mockFetch({
      ticket: baseTicket({ status: "OPEN" }),
      resolve: () => jsonResponse(409, { error: "INVALID_STATE", message: "This ticket is already Resolved, Closed or Cancelled." }),
    });
    renderScreen();
    await screen.findByText("TKT-2026-000001");

    fireEvent.click(screen.getByRole("button", { name: /problem appears resolved/i }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /yes, let it staff know/i }));

    const banner = await screen.findByRole("alert");
    // Exact ui-spec.md §7 copy — not the server's own generic message.
    expect(banner).toHaveTextContent(
      "This ticket has been updated by IT Staff. Refresh to see its current state.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const callsBeforeRefresh = fetchMock.mock.calls.filter(([url]: [string]) => url === TICKET_URL).length;
    fireEvent.click(within(banner).getByRole("button", { name: /refresh/i }));

    await screen.findByText("TKT-2026-000001");
    const callsAfterRefresh = fetchMock.mock.calls.filter(([url]: [string]) => url === TICKET_URL).length;
    expect(callsAfterRefresh).toBe(callsBeforeRefresh + 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
