import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.tsx";
import {
  REQUESTER_PAYLOAD,
  STAFF_ADMIN_PAYLOAD,
  STAFF_PAYLOAD,
  jsonResponse,
  stubFetch,
} from "./dashboardFixtures.ts";
import type { Role } from "../../src/auth/api.ts";

// `/dashboard` is one route for every role (ui-spec.md §2); the session's role
// picks the variant, and `/` lands there (D-12).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubApp(role: Role, dashboard: unknown) {
  return stubFetch((url) => {
    if (url.endsWith("/api/auth/me")) {
      return jsonResponse(200, {
        id: 7,
        name: "Test User",
        email: "t@example.edu",
        role,
        mustChangePassword: false,
      });
    }
    if (url.includes("/api/dashboard/")) return jsonResponse(200, dashboard);
    return jsonResponse(404, {});
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("/dashboard route", () => {
  it("renders the Requester variant and calls only the requester endpoint", async () => {
    const fetchMock = stubApp("REQUESTER", REQUESTER_PAYLOAD);
    renderAt("/dashboard");
    expect(await screen.findByRole("link", { name: /^Open Tickets:/ })).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.endsWith("/api/dashboard/requester"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/api/dashboard/staff"))).toBe(false);
  });

  it.each<[Role, unknown]>([
    ["IT_STAFF", STAFF_PAYLOAD],
    ["ADMINISTRATOR", STAFF_ADMIN_PAYLOAD],
  ])("renders the staff variant for %s and calls only the staff endpoint", async (role, payload) => {
    const fetchMock = stubApp(role, payload);
    renderAt("/dashboard");
    expect(await screen.findByRole("link", { name: /^Unassigned:/ })).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.endsWith("/api/dashboard/staff"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/api/dashboard/requester"))).toBe(false);
  });

  it("/ lands a logged-in user on the dashboard", async () => {
    stubApp("REQUESTER", REQUESTER_PAYLOAD);
    renderAt("/");
    expect(await screen.findByRole("link", { name: /^Open Tickets:/ })).toBeInTheDocument();
  });

  it("an Administrator may open the staff queue route (D-13)", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/auth/me")) {
        return jsonResponse(200, { id: 1, name: "A", email: "a@e.edu", role: "ADMINISTRATOR", mustChangePassword: false });
      }
      if (url.includes("/api/staff/tickets")) {
        return jsonResponse(200, { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
      }
      return jsonResponse(200, []);
    });
    renderAt("/staff/tickets");
    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to this page")).not.toBeInTheDocument();
  });
});
