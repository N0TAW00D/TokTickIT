import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ActionStatusBadge } from "../../src/components/ActionStatusBadge.tsx";
import { StatusBadge } from "../../src/components/StatusBadge.tsx";
import { StaffTicketDetailScreen } from "../../src/screens/StaffTicketDetailScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";
import { MetricCard } from "../../src/components/MetricCard.tsx";
import { StaffDashboardScreen } from "../../src/screens/StaffDashboardScreen.tsx";
import { RequesterDashboardScreen } from "../../src/screens/RequesterDashboardScreen.tsx";
import {
  REQUESTER_PAYLOAD,
  STAFF_PAYLOAD,
  jsonResponse,
  renderDashboard,
  stubFetch,
} from "./dashboardFixtures.ts";

// Lab 4 UI style rows (docs/lab-04/tests.md §2.8): S-01 (token discipline for
// the dashboard CSS and its new token), S-02 (Action badge distinct), S-03 (the
// needs-attention accent always comes with sub-label text), S-04 (contrast of
// the --zen-action-* pairs), S-05 (editable vs read-only), S-06 (private vs
// shared content). Technique follows
// the Lab 2/3 ui-style tests: CSS source and rendered class names, no pixels.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const DASHBOARD_CSS = [
  "components/MetricCard.css",
  "components/DrillDownChips.css",
  "dashboard/Dashboard.css",
];

describe("S-01 token discipline (dashboard CSS)", () => {
  it.each(DASHBOARD_CSS)("%s contains no hard-coded hex colour", (file) => {
    expect(read(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("theme.css defines --zen-metric-attention as the warning colour", () => {
    expect(read("styles/theme.css")).toMatch(/--zen-metric-attention:\s*var\(--zen-warning\)/);
  });

  it("the accent is a left border on the metric card, drawn from the token", () => {
    const css = read("components/MetricCard.css");
    expect(css).toMatch(
      /\.zen-metric-card--attention\s*\{[^}]*border-left-color:\s*var\(--zen-metric-attention\)/,
    );
  });
});

describe("S-03 needs-attention variant (AC-36, V-04)", () => {
  function attentionCards(container: HTMLElement) {
    return Array.from(container.querySelectorAll(".zen-metric-card--attention"));
  }

  it("MetricCard always renders its sub-label, with or without the accent", () => {
    const { container } = render(
      <MemoryRouter>
        <MetricCard label="Unassigned" value={2} to="/x" subLabel="Needs an owner" attention />
        <MetricCard label="Owned by Me" value={3} to="/y" subLabel="Open tickets you own" />
      </MemoryRouter>,
    );
    expect(attentionCards(container)).toHaveLength(1);
    for (const card of Array.from(container.querySelectorAll(".zen-metric-card"))) {
      expect(card.querySelector(".zen-metric-card__sublabel")?.textContent?.trim()).not.toBe("");
    }
  });

  it("every accented card on the staff dashboard carries words saying so", async () => {
    stubFetch(() => jsonResponse(200, STAFF_PAYLOAD));
    const { container } = renderDashboard("IT_STAFF", <StaffDashboardScreen />);
    await screen.findByRole("link", { name: /^Unassigned:/ });
    const accented = attentionCards(container);
    // Unassigned, Urgent and Follow-ups are all > 0 in this payload.
    expect(accented).toHaveLength(3);
    const texts = accented.map((card) => card.querySelector(".zen-metric-card__sublabel")?.textContent);
    expect(texts).toEqual(["Needs an owner", "High IT priority, needs attention", "Needs follow-up"]);
  });

  it("a zero card is never accented", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        ...STAFF_PAYLOAD,
        metrics: { unassigned: 0, ownedByMe: 0, urgent: 0, followUpsRequired: 0 },
      }),
    );
    const { container } = renderDashboard("IT_STAFF", <StaffDashboardScreen />);
    await screen.findByRole("link", { name: /^Unassigned:/ });
    expect(attentionCards(container)).toHaveLength(0);
  });

  it("Waiting for Me is accented with its sentence only when > 0 on the requester dashboard", async () => {
    stubFetch(() => jsonResponse(200, REQUESTER_PAYLOAD));
    const { container } = renderDashboard("REQUESTER", <RequesterDashboardScreen />);
    await screen.findByRole("link", { name: /^Waiting for Me:/ });
    const accented = attentionCards(container);
    expect(accented).toHaveLength(1);
    expect(accented[0].textContent).toContain("IT Staff are waiting for your reply");
  });
});

// ---------------------------------------------------------------------------
// S-02 / S-04: the Action status badge and its tokens (ui-spec.md §1, V-08).
// ---------------------------------------------------------------------------

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `${selector} rule not found`).not.toBeNull();
  return match![1];
}

describe("S-02 Action badge is distinct from the Ticket StatusBadge (AC-43, V-08)", () => {
  const LABELS: [string, string][] = [
    ["PLANNED", "Planned"],
    ["IN_PROGRESS", "In progress"],
    ["COMPLETED", "Completed"],
    ["CANCELLED", "Cancelled"],
  ];

  it.each(LABELS)("%s renders its text label in the non-pill action class", (value, label) => {
    const { container } = render(<ActionStatusBadge value={value} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe(label);
    expect(badge.className).toMatch(/\bzen-action-status\b/);
    expect(badge.className).not.toMatch(/\bzen-badge\b/);
  });

  it(".zen-action-status uses a small fixed radius, never the 999px pill token", () => {
    const body = ruleBody(read("components/ActionStatusBadge.css"), ".zen-action-status");
    const radius = /border-radius:\s*([^;]+);/.exec(body)?.[1].trim();
    expect(radius).toBe("4px");
    expect(body).not.toMatch(/--zen-radius-badge|999px/);
  });

  it("the Ticket StatusBadge keeps its pill (unchanged)", () => {
    const { container } = render(<StatusBadge value="IN_PROGRESS" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toMatch(/\bzen-badge\b/);
    expect(badge.className).not.toMatch(/zen-action-status/);
    expect(ruleBody(read("components/Badge.css"), ".zen-badge")).toMatch(
      /border-radius:\s*var\(--zen-radius-badge\)/,
    );
    expect(read("styles/theme.css")).toMatch(/--zen-radius-badge:\s*999px/);
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("S-04 contrast of the --zen-action-* tokens (AC-43)", () => {
  const theme = read("styles/theme.css");
  const token = (name: string) => {
    const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme);
    expect(match, `${name} not defined as a 6-digit hex in theme.css`).not.toBeNull();
    return match![1];
  };

  it.each(["planned", "progress", "done", "cancelled"])(
    "--zen-action-%s-text on its -bg is at least 4.5:1",
    (name) => {
      const ratio = contrast(token(`--zen-action-${name}-bg`), token(`--zen-action-${name}-text`));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("defines exactly the four pairs the badge CSS uses", () => {
    const defined = new Set(
      Array.from(theme.matchAll(/--zen-action-([a-z]+)-(?:bg|text):/g)).map((m) => m[1]),
    );
    const used = new Set(
      Array.from(read("components/ActionStatusBadge.css").matchAll(/var\(--zen-action-([a-z]+)-(?:bg|text)\)/g)).map(
        (m) => m[1],
      ),
    );
    expect([...defined].sort()).toEqual(["cancelled", "done", "planned", "progress"]);
    expect([...used].sort()).toEqual([...defined].sort());
  });
});

// ---------------------------------------------------------------------------
// S-05 / S-06 render the real staff Ticket Detail with Actions Taken.
// ---------------------------------------------------------------------------

const API = "http://localhost:3000";
const STAFF: AuthUser = {
  id: 9,
  name: "Jordan Lee",
  email: "jordan.lee@example.edu",
  role: "IT_STAFF",
  mustChangePassword: false,
};

function jsonRes(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}

function stubStaffScreenFetch() {
  const ticket = {
    id: 21,
    ticketNumber: "TKT-2026-000021",
    requester: { id: 7, name: "Jennifer Anderson", email: "j@example.edu" },
    category: { id: 4, name: "Network" },
    relatedSystem: { id: 7, name: "Corporate Laptop" },
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    status: "IN_PROGRESS",
    owner: { id: 9, name: "Jordan Lee" },
    requesterResolvedAt: null,
    summary: "Printer not connecting",
    description: "Disconnects every few minutes.",
    createdAt: "2026-09-01T08:14:00.000Z",
    updatedAt: "2026-09-05T09:30:00.000Z",
    attachments: [],
    version: 3,
  };
  const oneAction = {
    id: 5,
    ticketId: 21,
    actionAt: "2026-10-01T03:00:00.000Z",
    description: "Restarted the print spooler",
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
  };
  const history = [
    {
      id: 1,
      fromStatus: "NEW",
      toStatus: "IN_PROGRESS",
      changedBy: { id: 9, name: "Jordan Lee" },
      changedAt: "2026-09-02T08:00:00.000Z",
    },
  ];
  const thread = [
    {
      id: 1,
      body: "Entry text",
      author: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
      createdAt: "2026-09-03T08:00:00.000Z",
    },
  ];
  stubFetch((url) => {
    const path = url.replace(API, "");
    if (path === "/api/tickets/21") return jsonResponse(200, ticket);
    if (path === "/api/tickets/21/actions-taken") return jsonRes([oneAction]);
    if (path === "/api/tickets/21/status-history") return jsonRes(history);
    if (path === "/api/tickets/21/comments" || path === "/api/tickets/21/notes") return jsonRes(thread);
    if (path === "/api/staff/assignable-users") return jsonRes([]);
    return jsonResponse(404, {});
  });
}

function Bootstrap({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) setUser(STAFF);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

async function renderStaffDetail() {
  stubStaffScreenFetch();
  const view = render(
    <AuthProvider>
      <Bootstrap>
        <MemoryRouter initialEntries={["/staff/tickets/21"]}>
          <Routes>
            <Route path="/staff/tickets/:id" element={<StaffTicketDetailScreen />} />
          </Routes>
        </MemoryRouter>
      </Bootstrap>
    </AuthProvider>,
  );
  await screen.findByText("TKT-2026-000021");
  const card = await screen.findByRole("region", { name: /^Actions Taken/ });
  await within(card).findByText("Restarted the print spooler");
  return { ...view, card };
}

describe("S-05 editable vs read-only (AC-37, V-06)", () => {
  it("form controls carry the editable class; Performed by is static text on the read-only surface", async () => {
    const { card } = await renderStaffDetail();
    fireEvent.click(within(card).getByRole("button", { name: "Add action" }));

    const form = card.querySelector("form") as HTMLElement;
    const controls = Array.from(
      form.querySelectorAll<HTMLElement>(".zen-input, .zen-textarea, .zen-select"),
    );
    expect(controls.length).toBeGreaterThanOrEqual(4);
    for (const control of controls) {
      expect(control.className).not.toMatch(/--readonly/);
      expect(control.hasAttribute("readonly")).toBe(false);
      expect(control.hasAttribute("disabled")).toBe(false);
    }

    const performedBy = form.querySelector(".zen-action-form__static") as HTMLElement;
    expect(performedBy.textContent).toBe("Jordan Lee");
    expect(performedBy.matches("input, textarea, select")).toBe(false);
    expect(performedBy.className).not.toMatch(/zen-input|zen-textarea|zen-select/);
  });

  it("View mode renders the details block that carries the read-only surface", async () => {
    const { card } = await renderStaffDetail();
    fireEvent.click(within(card).getByRole("button", { name: /^View action from/ }));
    const details = card.querySelector(".zen-actions__details") as HTMLElement;
    expect(details).not.toBeNull();
    expect(details.querySelector("input, textarea, select")).toBeNull();
  });

  it("CSS: editable controls sit on --zen-surface; Performed by and View mode on --zen-readonly-bg", () => {
    expect(ruleBody(read("components/Controls.css"), ".zen-input,\n.zen-textarea,\n.zen-select")).toMatch(
      /background:\s*var\(--zen-surface\)/,
    );
    for (const [file, selector] of [
      ["components/ActionTakenForm.css", ".zen-action-form__static"],
      ["components/ActionsTakenCard.css", ".zen-actions__details"],
    ] as const) {
      const body = ruleBody(read(file), selector);
      expect(body).toMatch(/background:\s*var\(--zen-readonly-bg\)/);
      expect(body).toMatch(/color:\s*var\(--zen-readonly-text\)/);
    }
  });
});

describe("S-06 private vs shared content (AC-37, AC-39, V-17)", () => {
  it("Internal Notes carry the private class and 'Private' badge; Actions Taken, history and Public Comments carry none", async () => {
    const { container, card } = await renderStaffDetail();
    await screen.findByRole("heading", { name: "Internal notes" });
    await screen.findByRole("heading", { name: "Comments" });

    const notes = container.querySelector(".thread--internal") as HTMLElement;
    expect(notes).not.toBeNull();
    expect(within(notes).getByText(/^Private/)).toBeInTheDocument();
    expect(container.querySelectorAll(".thread--internal")).toHaveLength(1);

    const comments = container.querySelector(".thread--public") as HTMLElement;
    const history = screen.getByRole("heading", { name: "Status history" }).closest("section") as HTMLElement;
    for (const shared of [card, history, comments]) {
      expect(shared.className).not.toMatch(/thread--internal|private/i);
      expect(shared.querySelector(".thread--internal, .zen-message-thread__privacy-badge")).toBeNull();
      expect(shared.textContent).not.toMatch(/Private/);
    }
    expect(within(card).getByText("Visible to the requester")).toBeInTheDocument();
  });

  it("no CSS outside the internal thread references the private tokens", () => {
    for (const file of [
      "components/ActionsTakenCard.css",
      "components/ActionTakenForm.css",
      "components/ActionStatusBadge.css",
      "components/StatusHistoryCard.css",
    ]) {
      expect(read(file), file).not.toMatch(/--zen-private/);
    }
    const thread = read("components/MessageThread.css");
    expect(ruleBody(thread, ".thread--internal")).toMatch(/--zen-private-bg/);
    expect(thread.replace(/\.thread--internal[^{]*\{[^}]*\}/g, "")).not.toMatch(/--zen-private/);
  });
});

describe("STY form and card surfaces, callouts, mobile order (ui-spec.md §8; Lab 2 style table)", () => {
  const hasSurface = (body: string) => {
    expect(body).toMatch(/background:\s*var\(--zen-surface\)/);
    expect(body).toMatch(/border:\s*1px solid var\(--zen-border\)/);
    expect(body).toMatch(/box-shadow:\s*var\(--zen-shadow-card\)/);
  };

  it("S-08 the form panel and the mobile Action cards use surface, border and shadow tokens together", () => {
    hasSurface(ruleBody(read("components/ActionTakenForm.css"), ".zen-action-form"));
    hasSurface(ruleBody(read("components/ActionsTakenCard.css"), ".zen-actions__item"));
  });

  it("S-07 form callouts use the error tokens (text and border); amber only on the stale warning variant", () => {
    const css = read("components/ActionTakenForm.css");
    const base = ruleBody(css, ".zen-action-form__callout");
    expect(base).toMatch(/color:\s*var\(--zen-error\)/);
    expect(base).toMatch(/background:\s*var\(--zen-error-bg\)/);
    expect(base).toMatch(/border:\s*1px solid var\(--zen-error\)/);
    expect(base).not.toMatch(/--zen-warning/);
    const warning = ruleBody(css, ".zen-action-form__callout--warning");
    expect(warning).toMatch(/color:\s*var\(--zen-warning\)/);
    expect(warning).toMatch(/border-color:\s*var\(--zen-warning\)/);
  });

  it("S-09 on mobile the Save button stays above Cancel (no column-reverse)", () => {
    const css = read("components/ActionTakenForm.css");
    const media = /@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(media).not.toBeNull();
    expect(ruleBody(media![1], ".zen-action-form__buttons")).toMatch(/flex-direction:\s*column;/);
    expect(css).not.toMatch(/column-reverse/);
  });
});
