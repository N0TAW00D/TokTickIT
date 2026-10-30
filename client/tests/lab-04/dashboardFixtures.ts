import { vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser, Role } from "../../src/auth/api.ts";

/** Shared fixtures and render helpers for the Lab 4 dashboard component tests. */

export const API = "http://localhost:3000";

export function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function AuthBootstrap({ user, children }: { user: AuthUser; children: ReactNode }) {
  const { user: current, setUser } = useAuth();
  useEffect(() => {
    if (!current) setUser(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!current) return null;
  return children as never;
}

export function makeUser(role: Role): AuthUser {
  return {
    id: 7,
    name: "Priya Natarajan",
    email: "priya@example.edu",
    role,
    mustChangePassword: false,
  };
}

/** Renders `element` at `/dashboard` as `role`, with a catch-all route so links never 404 inside the test. */
export function renderDashboard(role: Role, element: ReactNode) {
  return render(
    createElement(
      AuthProvider,
      null,
      createElement(
        AuthBootstrap,
        { user: makeUser(role) },
        createElement(
          MemoryRouter,
          { initialEntries: ["/dashboard"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/dashboard", element }),
            createElement(Route, { path: "*", element: createElement("p", null, "elsewhere") }),
          ),
        ),
      ),
    ),
  );
}

export function stubFetch(handler: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: string) => handler(input));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const STAFF_PAYLOAD = {
  generatedAt: "2026-10-12T07:05:00.000Z",
  timeZone: "Asia/Bangkok",
  windowStart: "2026-10-05T17:00:00.000Z",
  metrics: { unassigned: 2, ownedByMe: 3, urgent: 1, followUpsRequired: 2 },
  byStatus: {
    NEW: 1,
    OPEN: 2,
    IN_PROGRESS: 3,
    WAITING_FOR_REQUESTER: 1,
    RESOLVED: 2,
    CLOSED: 4,
    REOPENED: 0,
    CANCELLED: 1,
  },
  byItPriority: { LOW: 2, MEDIUM: 3, HIGH: 1 },
  myOpenActions: {
    actions: 3,
    tickets: 2,
    items: [
      {
        id: 18,
        ticketId: 41,
        ticketNumber: "TKT-2026-000041",
        description: "Reset the VPN profile",
        status: "PLANNED",
        actionAt: "2026-10-12T03:15:00.000Z",
        followUpRequired: false,
      },
      {
        id: 19,
        ticketId: 43,
        ticketNumber: "TKT-2026-000043",
        description: "Check printer queue",
        status: "IN_PROGRESS",
        actionAt: "2026-10-12T04:00:00.000Z",
        followUpRequired: true,
      },
    ],
  },
  urgentTickets: {
    total: 1,
    items: [
      {
        id: 41,
        ticketNumber: "TKT-2026-000041",
        summary: "VPN drops every few minutes",
        status: "IN_PROGRESS",
        itPriority: "HIGH",
        owner: { id: 7, name: "Priya Natarajan" },
        updatedAt: "2026-10-12T03:00:00.000Z",
      },
    ],
  },
  recentlyUpdated: {
    total: 9,
    items: [
      {
        id: 44,
        ticketNumber: "TKT-2026-000044",
        summary: "Cannot open shared drive",
        status: "OPEN",
        itPriority: "MEDIUM",
        owner: null,
        updatedAt: "2026-10-12T05:00:00.000Z",
      },
      {
        id: 41,
        ticketNumber: "TKT-2026-000041",
        summary: "VPN drops every few minutes",
        status: "IN_PROGRESS",
        itPriority: "HIGH",
        owner: { id: 7, name: "Priya Natarajan" },
        updatedAt: "2026-10-12T03:00:00.000Z",
      },
    ],
  },
};

export const STAFF_ADMIN_PAYLOAD = {
  ...STAFF_PAYLOAD,
  userCounts: [
    { role: "REQUESTER", active: 4, inactive: 1 },
    { role: "IT_STAFF", active: 3, inactive: 1 },
    { role: "ADMINISTRATOR", active: 2, inactive: 0 },
  ],
};

export const STAFF_ZERO_PAYLOAD = {
  generatedAt: "2026-10-12T07:05:00.000Z",
  timeZone: "Asia/Bangkok",
  windowStart: "2026-10-05T17:00:00.000Z",
  metrics: { unassigned: 0, ownedByMe: 0, urgent: 0, followUpsRequired: 0 },
  byStatus: {
    NEW: 0,
    OPEN: 0,
    IN_PROGRESS: 0,
    WAITING_FOR_REQUESTER: 0,
    RESOLVED: 0,
    CLOSED: 0,
    REOPENED: 0,
    CANCELLED: 0,
  },
  byItPriority: { LOW: 0, MEDIUM: 0, HIGH: 0 },
  myOpenActions: { actions: 0, tickets: 0, items: [] },
  urgentTickets: { total: 0, items: [] },
  recentlyUpdated: { total: 0, items: [] },
};

export const REQUESTER_PAYLOAD = {
  generatedAt: "2026-10-12T07:05:00.000Z",
  timeZone: "Asia/Bangkok",
  windowStart: "2026-10-05T17:00:00.000Z",
  metrics: { openTickets: 3, waitingForMe: 1 },
  recentlyUpdated: {
    total: 4,
    items: [
      {
        id: 41,
        ticketNumber: "TKT-2026-000041",
        summary: "VPN drops every few minutes",
        status: "WAITING_FOR_REQUESTER",
        updatedAt: "2026-10-12T03:00:00.000Z",
      },
    ],
  },
  recentlyResolved: {
    total: 1,
    items: [
      {
        id: 37,
        ticketNumber: "TKT-2026-000037",
        summary: "Printer jam on floor 2",
        status: "RESOLVED",
        updatedAt: "2026-10-11T10:00:00.000Z",
        resolvedAt: "2026-10-11T10:00:00.000Z",
      },
    ],
  },
};

export const REQUESTER_ZERO_PAYLOAD = {
  generatedAt: "2026-10-12T07:05:00.000Z",
  timeZone: "Asia/Bangkok",
  windowStart: "2026-10-05T17:00:00.000Z",
  metrics: { openTickets: 0, waitingForMe: 0 },
  recentlyUpdated: { total: 0, items: [] },
  recentlyResolved: { total: 0, items: [] },
};
