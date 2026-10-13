import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { StaffDashboardScreen } from "../../src/screens/StaffDashboardScreen.tsx";
import {
  API,
  STAFF_ADMIN_PAYLOAD,
  STAFF_PAYLOAD,
  STAFF_ZERO_PAYLOAD,
  jsonResponse,
  renderDashboard,
  stubFetch,
} from "./dashboardFixtures.ts";

// Covers docs/lab-04/tests.md C-03..C-07 (ui-spec.md §3, api-spec.md §5).

const STAFF_URL = `${API}/api/dashboard/staff`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderLoaded(payload: unknown = STAFF_PAYLOAD, role: "IT_STAFF" | "ADMINISTRATOR" = "IT_STAFF") {
  const fetchMock = stubFetch(() => jsonResponse(200, payload));
  renderDashboard(role, <StaffDashboardScreen />);
  await screen.findByRole("heading", { level: 1, name: "Dashboard" });
  await screen.findByRole("link", { name: /^Unassigned:/ });
  return fetchMock;
}

describe("C-03 staff dashboard cards (AC-36, FR-15)", () => {
  it("renders label, value and sub-label with the accessible names from §3.2", async () => {
    await renderLoaded();
    const unassigned = screen.getByRole("link", { name: "Unassigned: 2, view list" });
    expect(within(unassigned).getByText("Unassigned")).toBeInTheDocument();
    expect(within(unassigned).getByText("2")).toBeInTheDocument();
    expect(within(unassigned).getByText("Needs an owner")).toBeInTheDocument();
    expect(within(unassigned).getByText(/view list/i)).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Owned by Me: 3, view list" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Urgent: 1, view list" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Follow-ups Required: 2, view list" })).toBeInTheDocument();

    const actions = screen.getByRole("link", { name: "My Open Actions: 3, view list" });
    expect(within(actions).getByText("on 2 tickets")).toBeInTheDocument();
  });

  it("shows the Updated time in Bangkok and a Refresh button", async () => {
    await renderLoaded();
    // 07:05Z is 14:05 in Asia/Bangkok.
    expect(screen.getByText("Updated 14:05 (Bangkok)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("has one h1 and an h2 per band", async () => {
    await renderLoaded();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const name of [
      "Work queue",
      "Tickets by status",
      "Open by IT priority",
      "Urgent Tickets",
      "Recently Updated",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  it("lists the open actions with description, status and a ticket link", async () => {
    await renderLoaded();
    expect(screen.getByText("Reset the VPN profile")).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TKT-2026-000043" })).toHaveAttribute(
      "href",
      "/staff/tickets/43",
    );
  });
});

describe("C-04 breakdowns and lists (AC-28, AC-29)", () => {
  it("shows all eight status counts and three priority counts, zeros included", async () => {
    await renderLoaded();
    const statusBand = screen.getByRole("heading", { name: "Tickets by status" }).closest("section")!;
    const links = within(statusBand).getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(within(statusBand).getByRole("link", { name: "Reopened: 0, view list" })).toBeInTheDocument();
    expect(within(statusBand).getByRole("link", { name: "In Progress: 3, view list" })).toBeInTheDocument();
    expect(within(statusBand).getByRole("link", { name: "Waiting for Requester: 1, view list" })).toBeInTheDocument();

    const prioBand = screen.getByRole("heading", { name: "Open by IT priority" }).closest("section")!;
    expect(within(prioBand).getAllByRole("link")).toHaveLength(3);
    expect(within(prioBand).getByRole("link", { name: "IT Priority Low: 2, view list" })).toBeInTheDocument();
    expect(within(prioBand).getByRole("link", { name: "IT Priority High: 1, view list" })).toBeInTheDocument();
  });

  it("renders Urgent Tickets and Recently Updated with 'View all (N)' links", async () => {
    await renderLoaded();
    const urgent = screen.getByRole("heading", { name: "Urgent Tickets" }).closest("section")!;
    expect(within(urgent).getByRole("link", { name: "View all (1)" })).toBeInTheDocument();
    expect(within(urgent).getByRole("link", { name: "TKT-2026-000041" })).toBeInTheDocument();
    expect(within(urgent).getByText("VPN drops every few minutes")).toBeInTheDocument();

    const recent = screen.getByRole("heading", { name: "Recently Updated" }).closest("section")!;
    expect(within(recent).getByRole("link", { name: "View all (9)" })).toBeInTheDocument();
    expect(within(recent).getAllByRole("listitem")).toHaveLength(2);
    expect(within(recent).getByText("Unassigned")).toBeInTheDocument();
  });
});

describe("C-05 drill-down links (AC-34, api-spec.md §5)", () => {
  it("every card, count and list link carries the §5 href", async () => {
    await renderLoaded();
    const href = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");

    expect(href(/^Unassigned:/)).toBe("/staff/tickets?owner=unassigned&scope=open");
    expect(href(/^Owned by Me:/)).toBe("/staff/tickets?owner=me&scope=open");
    expect(href(/^Urgent:/)).toBe("/staff/tickets?itPriority=HIGH&scope=open");
    expect(href(/^Follow-ups Required:/)).toBe("/staff/tickets?followUp=true&scope=open");
    expect(href(/^My Open Actions:/)).toBe("/staff/tickets?myActions=true&scope=open");

    expect(href("New: 1, view list")).toBe("/staff/tickets?status=NEW");
    expect(href("Waiting for Requester: 1, view list")).toBe(
      "/staff/tickets?status=WAITING_FOR_REQUESTER",
    );
    expect(href("Cancelled: 1, view list")).toBe("/staff/tickets?status=CANCELLED");
    expect(href("IT Priority Medium: 3, view list")).toBe(
      "/staff/tickets?itPriority=MEDIUM&scope=open",
    );

    const urgent = screen.getByRole("heading", { name: "Urgent Tickets" }).closest("section")!;
    expect(within(urgent).getByRole("link", { name: "View all (1)" })).toHaveAttribute(
      "href",
      "/staff/tickets?itPriority=HIGH&scope=open",
    );
    expect(within(urgent).getByRole("link", { name: "TKT-2026-000041" })).toHaveAttribute(
      "href",
      "/staff/tickets/41",
    );
    const recent = screen.getByRole("heading", { name: "Recently Updated" }).closest("section")!;
    expect(within(recent).getByRole("link", { name: "View all (9)" })).toHaveAttribute(
      "href",
      "/staff/tickets?scope=recent&sort=updatedAt&direction=desc",
    );
    expect(within(recent).getByRole("link", { name: "TKT-2026-000044" })).toHaveAttribute(
      "href",
      "/staff/tickets/44",
    );
    const actions = screen.getByText("Reset the VPN profile").closest("li")!;
    expect(within(actions).getByRole("link", { name: "TKT-2026-000041" })).toHaveAttribute(
      "href",
      "/staff/tickets/41",
    );
  });
});

describe("C-06 states (AC-32, AC-36)", () => {
  it("shows a role=status loading skeleton and no numbers until the payload arrives", async () => {
    let resolve!: (r: Response) => void;
    stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    renderDashboard("IT_STAFF", <StaffDashboardScreen />);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view list/ })).not.toBeInTheDocument();
    resolve({ ok: true, status: 200, json: () => Promise.resolve(STAFF_PAYLOAD) } as Response);
    expect(await screen.findByRole("link", { name: /^Unassigned:/ })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("all-zero payload still renders every card with 0, 'None right now' and the empty-list messages", async () => {
    await renderLoaded(STAFF_ZERO_PAYLOAD);
    const unassigned = screen.getByRole("link", { name: "Unassigned: 0, view list" });
    expect(within(unassigned).getByText("0")).toBeInTheDocument();
    expect(within(unassigned).getByText("None right now")).toBeInTheDocument();
    expect(unassigned).toHaveAttribute("href", "/staff/tickets?owner=unassigned&scope=open");
    expect(screen.getAllByText("None right now").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("No urgent tickets.")).toBeInTheDocument();
    expect(screen.getByText("No tickets updated in the last 7 days.")).toBeInTheDocument();
    expect(screen.getByText("You have no open actions.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reopened: 0, view list" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failure renders an alert with Retry, no numbers, and Retry refetches", async () => {
    let calls = 0;
    const fetchMock = stubFetch(() => {
      calls += 1;
      return calls === 1 ? jsonResponse(500, {}) : jsonResponse(200, STAFF_PAYLOAD);
    });
    renderDashboard("IT_STAFF", <StaffDashboardScreen />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't load the dashboard.");
    expect(screen.queryByRole("link", { name: /view list/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: /^Unassigned:/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a 403 from the endpoint renders the forbidden state with no numbers", async () => {
    stubFetch(() => jsonResponse(403, { error: "FORBIDDEN" }));
    renderDashboard("IT_STAFF", <StaffDashboardScreen />);
    expect(
      await screen.findByRole("heading", { name: "You don't have access to this page" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: /view list/ })).not.toBeInTheDocument();
  });

  it("Refresh keeps the previous data visible while the new payload is in flight", async () => {
    let calls = 0;
    let resolveSecond!: (r: Response) => void;
    stubFetch(() => {
      calls += 1;
      if (calls === 1) return jsonResponse(200, STAFF_PAYLOAD);
      return new Promise<Response>((r) => (resolveSecond = r));
    });
    renderDashboard("IT_STAFF", <StaffDashboardScreen />);
    await screen.findByRole("link", { name: /^Unassigned:/ });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("link", { name: "Unassigned: 2, view list" })).toBeInTheDocument();

    resolveSecond({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...STAFF_PAYLOAD, metrics: { ...STAFF_PAYLOAD.metrics, unassigned: 5 } }),
    } as Response);
    expect(await screen.findByRole("link", { name: "Unassigned: 5, view list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("requests only /api/dashboard/staff with credentials", async () => {
    const fetchMock = await renderLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(STAFF_URL);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ credentials: "include" });
  });
});

describe("C-07 Users strip (AC-31)", () => {
  it("Administrator sees three cards with the total as the value and active/inactive sub-label", async () => {
    await renderLoaded(STAFF_ADMIN_PAYLOAD, "ADMINISTRATOR");
    const band = screen.getByRole("heading", { level: 2, name: "Users" }).closest("section")!;
    const requesters = within(band).getByRole("link", { name: "Requesters: 5, view list" });
    expect(requesters).toHaveAttribute("href", "/admin/users?role=REQUESTER");
    expect(within(requesters).getByText("4 active · 1 inactive")).toBeInTheDocument();
    const staff = within(band).getByRole("link", { name: "IT Staff: 4, view list" });
    expect(staff).toHaveAttribute("href", "/admin/users?role=IT_STAFF");
    const admins = within(band).getByRole("link", { name: "Administrators: 2, view list" });
    expect(admins).toHaveAttribute("href", "/admin/users?role=ADMINISTRATOR");
    expect(within(admins).getByText("2 active · 0 inactive")).toBeInTheDocument();
  });

  it("is absent for IT Staff (no userCounts in the payload)", async () => {
    await renderLoaded(STAFF_PAYLOAD, "IT_STAFF");
    expect(screen.queryByRole("heading", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Requesters:/ })).not.toBeInTheDocument();
  });
});
