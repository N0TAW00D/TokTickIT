import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { TicketDetailScreen } from "../../src/screens/TicketDetailScreen.tsx";
import {
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";

// Covers docs/lab-02/tests.md row C-29 (read-only header render) plus the
// loading/failure/not-found states and the X-Requester-Id header ui-spec.md
// §10 requires. The attachment section (C-15..C-21) and the requester-switch
// behavior (C-32) belong elsewhere and are not covered here.

const API_BASE_URL = "http://localhost:3000";
const TICKET_URL = `${API_BASE_URL}/api/tickets/1`;

const TICKET = {
  id: 1,
  ticketNumber: "TKT-2026-000001",
  requester: {
    id: 7,
    name: "Jennifer Anderson",
    email: "jennifer.anderson@example.edu",
  },
  category: { id: 2, name: "Hardware" },
  relatedSystem: { id: 7, name: "Corporate Laptop" },
  requestedPriority: "MEDIUM",
  status: "NEW",
  summary: "Laptop battery drains quickly",
  description:
    "My laptop battery is draining much faster than usual even when the system is idle.",
  createdAt: "2026-09-01T08:14:00.000Z",
  updatedAt: "2026-09-01T09:02:00.000Z",
  attachments: [
    {
      id: 5,
      originalFilename: "battery-report.pdf",
      mimeType: "application/pdf",
      fileSize: 249184,
      isRemoved: false,
      removedAt: null,
      removedReason: null,
      createdAt: "2026-09-01T08:15:10.000Z",
    },
  ],
};

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockFetch(handler?: () => Promise<Response>) {
  const fetchMock = vi.fn(() => (handler ?? (() => jsonResponse(200, TICKET)))());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Seeds the RequesterContext the same way a real Continue click / route
 * guard pass would (mirrors CreateTicket.test.tsx's Bootstrap), so this
 * screen can be rendered directly without RequireRequester or the
 * selection screen.
 */
function Bootstrap({
  id = 7,
  name = "Jennifer Anderson",
  children,
}: {
  id?: number;
  name?: string;
  children: ReactNode;
}) {
  const { requesterName, selectRequester } = useRequester();

  useEffect(() => {
    if (requesterName === null) {
      selectRequester({ id, name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (requesterName === null) return null;

  return <>{children}</>;
}

function renderScreen({
  requesterId = 7,
  ticketPath = "/tickets/1",
}: { requesterId?: number; ticketPath?: string } = {}) {
  return render(
    <RequesterProvider>
      <Bootstrap id={requesterId}>
        <MemoryRouter initialEntries={[ticketPath]}>
          <Routes>
            <Route path="/tickets/:id" element={<TicketDetailScreen />} />
            <Route path="/tickets" element={<h1>My Tickets</h1>} />
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

describe("C-29 Ticket Detail read-only render", () => {
  it("renders every header field as static text matching the mocked response, with no inputs", async () => {
    mockFetch();
    const { container } = renderScreen();

    await screen.findByText(TICKET.ticketNumber);

    // Scoped to the ticket information card: the app shell's own
    // RequesterBadge also renders the Requester's name, so an unscoped
    // query would be ambiguous.
    const card = container.querySelector(".zen-ticket-detail__card");
    if (!card) throw new Error("ticket information card did not render");
    const detail = within(card as HTMLElement);

    expect(detail.getByText("1 Sep 2026, 08:14")).toBeInTheDocument();
    expect(detail.getByText(TICKET.category.name)).toBeInTheDocument();
    expect(detail.getByText(TICKET.requester.name)).toBeInTheDocument();
    expect(detail.getByText(TICKET.relatedSystem.name)).toBeInTheDocument();
    expect(detail.getByText(TICKET.summary)).toBeInTheDocument();
    expect(detail.getByText(TICKET.description)).toBeInTheDocument();
    expect(detail.getByText("Medium")).toBeInTheDocument();
    expect(detail.getByText("New")).toBeInTheDocument();

    // This is the read-only detail view — no field is an editable control.
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });

  it("does not render an attachment section even though the API response includes attachments", async () => {
    mockFetch();
    renderScreen();

    await screen.findByText(TICKET.ticketNumber);

    expect(
      screen.queryByText(/battery-report\.pdf/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/attachment/i)).not.toBeInTheDocument();
  });

  it("sends X-Requester-Id on the detail request", async () => {
    const fetchMock = mockFetch();
    renderScreen({ requesterId: 42 });

    await screen.findByText(TICKET.ticketNumber);

    expect(fetchMock).toHaveBeenCalledWith(
      TICKET_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Requester-Id": "42" }),
      }),
    );
  });

  it("shows the breadcrumb and a Back to My Tickets affordance that navigates to /tickets", async () => {
    mockFetch();
    renderScreen();

    await screen.findByText(TICKET.ticketNumber);

    // Scoped to the breadcrumb: the app shell's own primary nav also has a
    // "My Tickets" link, which would make an unscoped query ambiguous.
    const breadcrumb = within(screen.getByRole("navigation", { name: /breadcrumb/i }));
    expect(
      breadcrumb.getByRole("link", { name: /my tickets/i }),
    ).toHaveAttribute("href", "/tickets");

    const backButton = screen.getByRole("button", {
      name: /back to my tickets/i,
    });
    fireEvent.click(backButton);

    expect(
      await screen.findByRole("heading", { name: /my tickets/i }),
    ).toBeInTheDocument();
  });
});

describe("Ticket Detail loading state", () => {
  it("shows a role=status loading indicator while the request is pending", () => {
    mockFetch(() => new Promise(() => {}));
    renderScreen();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(TICKET.ticketNumber)).not.toBeInTheDocument();
  });
});

describe("Ticket Detail failure state", () => {
  it("shows a role=alert ErrorState with Retry on a network failure, and Retry re-fetches", async () => {
    const fetchMock = mockFetch(() => Promise.reject(new Error("network down")));
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not load this ticket. Please check your connection and try again.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(() => jsonResponse(200, TICKET));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await screen.findByText(TICKET.ticketNumber);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the same failure state on a 500 response", async () => {
    mockFetch(() => jsonResponse(500, { error: "INTERNAL" }));
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not load this ticket. Please check your connection and try again.",
    );
  });
});

describe("Ticket Detail not-found state", () => {
  it("shows a clear not-found message (not a generic crash) on a 404, with no ticket data and a Back link", async () => {
    mockFetch(() => jsonResponse(404, { error: "NOT_FOUND" }));
    renderScreen({ ticketPath: "/tickets/999" });

    expect(await screen.findByText(/ticket not found/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        "This ticket doesn't exist or isn't associated with the current development requester.",
      ),
    ).toBeInTheDocument();

    // Never implies the ticket exists but is merely forbidden.
    expect(screen.queryByText(/forbidden/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(TICKET.ticketNumber)).not.toBeInTheDocument();

    const backButton = screen.getByRole("button", {
      name: /back to my tickets/i,
    });
    fireEvent.click(backButton);

    expect(
      await screen.findByRole("heading", { name: /my tickets/i }),
    ).toBeInTheDocument();
  });

  it("shows the identical not-found state for a ticket owned by a different Requester (BR-14/BR-42)", async () => {
    // The server answers an unknown id and a not-owned id with a byte-
    // identical 404 — the client has no way to (and must not) distinguish
    // them, so both drive the exact same UI state.
    mockFetch(() => jsonResponse(404, { error: "NOT_FOUND" }));
    renderScreen({ requesterId: 99, ticketPath: "/tickets/1" });

    expect(await screen.findByText(/ticket not found/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        "This ticket doesn't exist or isn't associated with the current development requester.",
      ),
    ).toBeInTheDocument();
  });
});
