import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { RequesterDashboardScreen } from "../../src/screens/RequesterDashboardScreen.tsx";
import {
  REQUESTER_PAYLOAD,
  REQUESTER_ZERO_PAYLOAD,
  jsonResponse,
  renderDashboard,
  stubFetch,
} from "./dashboardFixtures.ts";

// Covers docs/lab-04/tests.md C-08 and C-09 (ui-spec.md §4, api-spec.md §4).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderLoaded(payload: unknown = REQUESTER_PAYLOAD) {
  const fetchMock = stubFetch(() => jsonResponse(200, payload));
  renderDashboard("REQUESTER", <RequesterDashboardScreen />);
  await screen.findByRole("link", { name: /^Open Tickets:/ });
  return fetchMock;
}

describe("C-08 requester dashboard (AC-02, AC-36)", () => {
  it("renders Open Tickets and Waiting for Me cards with the §3.2 accessible names", async () => {
    await renderLoaded();
    const open = screen.getByRole("link", { name: "Open Tickets: 3, view list" });
    expect(within(open).getByText("Open Tickets")).toBeInTheDocument();
    expect(within(open).getByText("3")).toBeInTheDocument();
    const waiting = screen.getByRole("link", { name: "Waiting for Me: 1, view list" });
    expect(within(waiting).getByText("IT Staff are waiting for your reply")).toBeInTheDocument();
  });

  it("renders the Updated time, Refresh, one h1 and h2 bands", async () => {
    await renderLoaded();
    expect(screen.getByText("Updated 14:05 (Bangkok)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Recently Updated" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Recently Resolved" })).toBeInTheDocument();
  });

  it("renders both lists with ticket number, summary and a status badge with text", async () => {
    await renderLoaded();
    const updated = screen.getByRole("heading", { name: "Recently Updated" }).closest("section")!;
    expect(within(updated).getByText("VPN drops every few minutes")).toBeInTheDocument();
    expect(within(updated).getByText("Waiting for Requester")).toBeInTheDocument();
    expect(within(updated).getByRole("link", { name: "View all (4)" })).toBeInTheDocument();
    const resolved = screen.getByRole("heading", { name: "Recently Resolved" }).closest("section")!;
    expect(within(resolved).getByText("Printer jam on floor 2")).toBeInTheDocument();
    expect(within(resolved).getByText("Resolved")).toBeInTheDocument();
    expect(within(resolved).getByRole("link", { name: "View all (1)" })).toBeInTheDocument();
  });

  it("uses the calm sub-label when nobody is waiting (needs-attention only when Waiting > 0)", async () => {
    await renderLoaded({
      ...REQUESTER_PAYLOAD,
      metrics: { openTickets: 3, waitingForMe: 0 },
    });
    const waiting = screen.getByRole("link", { name: "Waiting for Me: 0, view list" });
    expect(within(waiting).getByText("Nothing is waiting for you.")).toBeInTheDocument();
    expect(waiting).not.toHaveClass("zen-metric-card--attention");
  });

  it("never shows IT Priority, owner or internal data", async () => {
    await renderLoaded();
    expect(screen.queryByText(/IT:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/IT Priority/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unassigned/i)).not.toBeInTheDocument();
  });
});

describe("C-09 links and states (AC-32, AC-34, AC-36)", () => {
  it("every card and list link carries the §4 href", async () => {
    await renderLoaded();
    expect(screen.getByRole("link", { name: /^Open Tickets:/ })).toHaveAttribute(
      "href",
      "/tickets?scope=open",
    );
    expect(screen.getByRole("link", { name: /^Waiting for Me:/ })).toHaveAttribute(
      "href",
      "/tickets?status=WAITING_FOR_REQUESTER",
    );
    const updated = screen.getByRole("heading", { name: "Recently Updated" }).closest("section")!;
    expect(within(updated).getByRole("link", { name: "View all (4)" })).toHaveAttribute(
      "href",
      "/tickets?scope=recent&sort=updatedAt&order=desc",
    );
    expect(within(updated).getByRole("link", { name: "TKT-2026-000041" })).toHaveAttribute(
      "href",
      "/tickets/41",
    );
    const resolved = screen.getByRole("heading", { name: "Recently Resolved" }).closest("section")!;
    expect(within(resolved).getByRole("link", { name: "View all (1)" })).toHaveAttribute(
      "href",
      "/tickets?scope=recently-resolved",
    );
    expect(within(resolved).getByRole("link", { name: "TKT-2026-000037" })).toHaveAttribute(
      "href",
      "/tickets/37",
    );
  });

  it("zero payload: cards show 0 with their empty messages, and both lists show theirs", async () => {
    await renderLoaded(REQUESTER_ZERO_PAYLOAD);
    const open = screen.getByRole("link", { name: "Open Tickets: 0, view list" });
    expect(within(open).getByText("You have no open tickets.")).toBeInTheDocument();
    expect(open).toHaveAttribute("href", "/tickets?scope=open");
    const waiting = screen.getByRole("link", { name: "Waiting for Me: 0, view list" });
    expect(within(waiting).getByText("Nothing is waiting for you.")).toBeInTheDocument();
    expect(screen.getByText("No tickets updated in the last 7 days.")).toBeInTheDocument();
    expect(screen.getByText("No tickets resolved in the last 7 days.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a role=status loading state and no numbers before the payload arrives", async () => {
    let resolve!: (r: Response) => void;
    stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    renderDashboard("REQUESTER", <RequesterDashboardScreen />);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view list/ })).not.toBeInTheDocument();
    resolve({ ok: true, status: 200, json: () => Promise.resolve(REQUESTER_PAYLOAD) } as Response);
    expect(await screen.findByRole("link", { name: /^Open Tickets:/ })).toBeInTheDocument();
  });

  it("failure shows an alert with Retry and no numbers; Retry refetches", async () => {
    let calls = 0;
    const fetchMock = stubFetch(() => {
      calls += 1;
      return calls === 1 ? jsonResponse(500, {}) : jsonResponse(200, REQUESTER_PAYLOAD);
    });
    renderDashboard("REQUESTER", <RequesterDashboardScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the dashboard.");
    expect(screen.queryByRole("link", { name: /view list/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: /^Open Tickets:/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/api/dashboard/requester");
  });

  it("a 403 renders the forbidden state with no numbers", async () => {
    stubFetch(() => jsonResponse(403, { error: "FORBIDDEN" }));
    renderDashboard("REQUESTER", <RequesterDashboardScreen />);
    expect(
      await screen.findByRole("heading", { name: "You don't have access to this page" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: /view list/ })).not.toBeInTheDocument();
  });
});
