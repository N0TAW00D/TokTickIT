import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { StatusBadge, type StatusValue } from "../../src/components/StatusBadge.tsx";
import { PriorityBadge } from "../../src/components/PriorityBadge.tsx";
import { RoleBadge, type RoleValue } from "../../src/components/RoleBadge.tsx";
import { LoginScreen } from "../../src/screens/LoginScreen.tsx";
import { ChangePasswordScreen } from "../../src/screens/ChangePasswordScreen.tsx";
import { StaffTicketDetailScreen } from "../../src/screens/StaffTicketDetailScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";
import type { TicketDetailResponse } from "../../src/tickets/api.ts";

// Covers docs/lab-03/tests.md §2.8, rows S-01 through S-06 (ui-spec.md's
// V-01/V-04/V-05/V-06/V-08/V-07). tests.md names this exact file for all
// six rows but it did not exist anywhere in the suite — a genuine gap, not
// just weaker-than-claimed coverage (a prior dispatch found one narrower
// near-miss for S-06 in StaffTicketDetail.test.tsx, asserting only the
// privacy badge's text colour — see that describe block below for how this
// file's S-06 differs).
//
// Technique follows client/tests/lab-02/ui-style.test.tsx exactly: reading
// CSS source files and/or asserting rendered class names, never visual/pixel
// comparison. vitest runs from client/, so src is at cwd/src.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CSS_SRC_DIR = join(process.cwd(), "src");

function readCss(rel: string): string {
  return readFileSync(join(CSS_SRC_DIR, rel), "utf8");
}

/** Every .css file under client/src, recursively. */
function cssFilesUnderSrc(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFilesUnderSrc(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// S-01 (ui-spec.md §2, V-01): token discipline — no hard-coded hex outside
// theme.css, and the seven Lab 3 tokens are defined with the exact values
// §2's table specifies.
// ---------------------------------------------------------------------------

describe("S-01 token discipline (ui-spec.md §2)", () => {
  const SEVEN_NEW_TOKENS: Record<string, string> = {
    "--zen-private-bg": "#f4f1e8",
    "--zen-private-border": "#c9bfa3",
    "--zen-private-text": "#6b5a2e",
    "--zen-unassigned": "#7a5d2b",
    "--zen-unassigned-bg": "#fbf3e4",
    "--zen-role-bg": "#ecf1fa",
    "--zen-role-text": "#3a3f58",
  };

  it("theme.css defines all seven new Lab 3 tokens with §2's exact values", () => {
    // Loaded into a real <style> so jsdom's getComputedStyle resolves the
    // custom-property *values* off :root — same technique lab-02's own
    // S-01 test uses for --zen-primary/--zen-page-bg.
    const style = document.createElement("style");
    style.textContent = readCss("styles/theme.css");
    document.head.appendChild(style);
    try {
      const root = getComputedStyle(document.documentElement);
      for (const [token, expected] of Object.entries(SEVEN_NEW_TOKENS)) {
        expect(root.getPropertyValue(token).trim().toLowerCase()).toBe(expected);
      }
    } finally {
      style.remove();
    }
  });

  it("no stylesheet outside theme.css contains a hard-coded hex colour", () => {
    const hex = /#[0-9a-fA-F]{3,8}\b/;
    const offenders: string[] = [];
    for (const file of cssFilesUnderSrc(CSS_SRC_DIR)) {
      if (file.endsWith("styles/theme.css")) continue;
      const body = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (hex.test(body)) offenders.push(file.slice(CSS_SRC_DIR.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S-02 (ui-spec.md §3, V-04): badge consistency — Status, Requested
// Priority, IT Priority and Role badges use their specified classes
// wherever they render. Proven two ways: (1) each badge component itself
// produces the right class/label for every value it knows, and (2) every
// screen that shows one of these badges imports the shared component
// rather than re-implementing badge markup, so (1)'s guarantee actually
// reaches every appearance.
// ---------------------------------------------------------------------------

describe("S-02 badge consistency (ui-spec.md §3, §3.1-§3.3)", () => {
  it.each([
    ["NEW", "zen-badge--status-new", "New"],
    ["OPEN", "zen-badge--status-open", "Open"],
    ["IN_PROGRESS", "zen-badge--status-in-progress", "In Progress"],
    ["WAITING_FOR_REQUESTER", "zen-badge--status-waiting-for-requester", "Waiting for Requester"],
    ["RESOLVED", "zen-badge--status-resolved", "Resolved"],
    ["CLOSED", "zen-badge--status-closed", "Closed"],
    ["REOPENED", "zen-badge--status-reopened", "Reopened"],
    ["CANCELLED", "zen-badge--status-cancelled", "Cancelled"],
  ] as [StatusValue, string, string][])(
    "StatusBadge renders %s with class %s and label %s",
    (value, expectedClass, expectedLabel) => {
      const { container } = render(<StatusBadge value={value} />);
      const badge = container.querySelector(".zen-badge");
      expect(badge).toHaveClass(expectedClass);
      expect(badge).toHaveTextContent(expectedLabel);
      cleanup();
    },
  );

  it.each([
    ["LOW", "zen-badge--priority-low", "Low"],
    ["MEDIUM", "zen-badge--priority-medium", "Medium"],
    ["HIGH", "zen-badge--priority-high", "High"],
  ] as const)(
    "PriorityBadge (Requested Priority, default variant) renders %s with class %s and label %s",
    (value, expectedClass, expectedLabel) => {
      const { container } = render(<PriorityBadge value={value} />);
      const badge = container.querySelector(".zen-badge");
      expect(badge).toHaveClass(expectedClass);
      expect(badge).not.toHaveClass("zen-badge--it-priority");
      expect(badge).toHaveTextContent(expectedLabel);
      cleanup();
    },
  );

  it.each([
    ["LOW", "zen-badge--priority-low", "IT: Low"],
    ["MEDIUM", "zen-badge--priority-medium", "IT: Medium"],
    ["HIGH", "zen-badge--priority-high", "IT: High"],
  ] as const)(
    "PriorityBadge (IT Priority, variant='it') renders %s with class %s, the it-priority modifier, and label %s",
    (value, expectedClass, expectedLabel) => {
      const { container } = render(<PriorityBadge value={value} variant="it" />);
      const badge = container.querySelector(".zen-badge");
      expect(badge).toHaveClass(expectedClass);
      expect(badge).toHaveClass("zen-badge--it-priority");
      expect(badge).toHaveTextContent(expectedLabel);
      cleanup();
    },
  );

  it.each([
    ["REQUESTER", "Requester"],
    ["IT_STAFF", "IT Staff"],
    ["ADMINISTRATOR", "Administrator"],
  ] as [RoleValue, string][])(
    "RoleBadge renders %s with class zen-badge--role and label %s",
    (value, expectedLabel) => {
      const { container } = render(<RoleBadge value={value} />);
      const badge = container.querySelector(".zen-badge");
      expect(badge).toHaveClass("zen-badge--role");
      expect(badge).toHaveTextContent(expectedLabel);
      cleanup();
    },
  );

  it("every screen/component that shows one of these badges imports the shared component — no re-implemented badge markup to drift out of sync", () => {
    // If a screen ever hard-coded e.g. "zen-badge--status-new" itself
    // instead of rendering <StatusBadge>, that literal class string would
    // show up outside the four files that are allowed to own it (the three
    // badge components and their shared stylesheets) — this is what makes
    // this test fail in that case.
    const badgeClassString = /zen-badge--(status|priority|role)/;
    const allowedOwners = new Set([
      "components/StatusBadge.tsx",
      "components/PriorityBadge.tsx",
      "components/RoleBadge.tsx",
      "components/Badge.css",
      "components/RoleBadge.css",
    ]);
    const offenders: string[] = [];

    function tsxFilesUnderSrc(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...tsxFilesUnderSrc(full));
        else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
      }
      return out;
    }

    for (const file of [...cssFilesUnderSrc(CSS_SRC_DIR), ...tsxFilesUnderSrc(CSS_SRC_DIR)]) {
      const rel = file.slice(CSS_SRC_DIR.length + 1);
      if (allowedOwners.has(rel)) continue;
      const body = readFileSync(file, "utf8");
      if (badgeClassString.test(body)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);

    // And the consuming surfaces ui-spec.md lists these badges on all
    // actually import from the canonical components (proves (1) above's
    // guarantee reaches them, rather than just proving no one else strayed).
    const expectedImporters: [string, RegExp][] = [
      ["shell/UserBadge.tsx", /from ["']\.\.\/components\/RoleBadge["']/],
      ["screens/UserManagementScreen.tsx", /from ["']\.\.\/components\/RoleBadge["']/],
      ["components/MessageThread.tsx", /from ["']\.\/RoleBadge["']/],
      ["screens/MyTicketsScreen.tsx", /from ["']\.\.\/components\/StatusBadge["']/],
      ["screens/MyTicketsScreen.tsx", /from ["']\.\.\/components\/PriorityBadge["']/],
      ["screens/TicketDetailScreen.tsx", /from ["']\.\.\/components\/StatusBadge["']/],
      ["screens/TicketDetailScreen.tsx", /from ["']\.\.\/components\/PriorityBadge["']/],
      ["screens/StaffTicketQueueScreen.tsx", /from ["']\.\.\/components\/StatusBadge["']/],
      ["screens/StaffTicketQueueScreen.tsx", /from ["']\.\.\/components\/PriorityBadge["']/],
      ["screens/StaffTicketDetailScreen.tsx", /from ["']\.\.\/components\/PriorityBadge["']/],
    ];
    for (const [rel, pattern] of expectedImporters) {
      const body = readFileSync(join(CSS_SRC_DIR, rel), "utf8");
      expect(body).toMatch(pattern);
    }
  });
});

// ---------------------------------------------------------------------------
// S-03 (ui-spec.md §3.1, V-05): priority vs status distinctness — no status
// badge pair shares both its background AND text colour token with a
// priority badge pair. Parsed straight from Badge.css/theme.css rather than
// hand-copied, so this actually fails if a future status pair reuses a
// priority pair's exact tokens.
// ---------------------------------------------------------------------------

describe("S-03 priority vs status distinctness (ui-spec.md §3.1)", () => {
  it("resolves every status/priority badge pair from the real CSS and confirms no (background, text) pair repeats across the two families", () => {
    const badgeCss = readCss("components/Badge.css");
    const themeCss = readCss("styles/theme.css");

    // token name -> hex value, from theme.css's `--token: value;` lines.
    const tokenValues: Record<string, string> = {};
    const tokenLineRe = /(--[a-z0-9-]+):\s*([^;]+);/g;
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = tokenLineRe.exec(themeCss))) {
      tokenValues[tokenMatch[1]] = tokenMatch[2].trim().toLowerCase();
    }
    expect(Object.keys(tokenValues).length).toBeGreaterThan(10);

    // badge class name (status-* / priority-*) -> { bg, text } token pair,
    // from Badge.css's `.zen-badge--<name> { background: var(--x); color:
    // var(--y); }` blocks.
    const pairs: Record<string, { bg: string; text: string }> = {};
    const blockRe = /\.zen-badge--(status-[a-z-]+|priority-(?:low|medium|high))\s*\{([^}]*)\}/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRe.exec(badgeCss))) {
      const name = blockMatch[1];
      const body = blockMatch[2];
      const bgToken = /background:\s*var\((--[a-z0-9-]+)\)/.exec(body)?.[1];
      const textToken = /color:\s*var\((--[a-z0-9-]+)\)/.exec(body)?.[1];
      expect(bgToken, `${name} is missing a background: var(--...) declaration`).toBeTruthy();
      expect(textToken, `${name} is missing a color: var(--...) declaration`).toBeTruthy();
      pairs[name] = { bg: bgToken!, text: textToken! };
    }

    const statusNames = Object.keys(pairs).filter((name) => name.startsWith("status-"));
    const priorityNames = Object.keys(pairs).filter((name) => name.startsWith("priority-"));
    // Sanity: all eight statuses and all three priorities were actually parsed.
    expect(statusNames).toHaveLength(8);
    expect(priorityNames).toHaveLength(3);

    const resolve = (token: string) => tokenValues[token] ?? token;

    for (const statusName of statusNames) {
      for (const priorityName of priorityNames) {
        const status = pairs[statusName];
        const priority = pairs[priorityName];
        const sharesBoth =
          resolve(status.bg) === resolve(priority.bg) &&
          resolve(status.text) === resolve(priority.text);
        expect(
          sharesBoth,
          `${statusName} and ${priorityName} share both background and text colour`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// S-04 (ui-spec.md §10, V-06): editable vs read-only — IT Staff Ticket
// Detail's read-only fields carry the read-only class; the operational
// (Ticket Owner / IT Priority / Status) fields do not.
// ---------------------------------------------------------------------------

const API_BASE_URL = "http://localhost:3000";
const S04_TICKET_ID = 55;
const S04_TICKET_URL = `${API_BASE_URL}/api/tickets/${S04_TICKET_ID}`;

function s04JsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function s04Ticket(): TicketDetailResponse {
  return {
    id: S04_TICKET_ID,
    ticketNumber: "TKT-2026-000055",
    requester: { id: 3, name: "Amina Okafor", email: "amina.okafor@example.edu" },
    category: { id: 2, name: "Hardware" },
    relatedSystem: { id: 5, name: "Desktop" },
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    status: "OPEN",
    owner: { id: 9, name: "Jordan Lee" },
    requesterResolvedAt: null,
    summary: "Monitor won't turn on",
    description: "No power light, tried a different outlet.",
    createdAt: "2026-09-01T08:14:00.000Z",
    updatedAt: "2026-09-05T09:30:00.000Z",
    attachments: [],
  } as TicketDetailResponse;
}

/** Serves the fixed ticket above plus the operational panel's supporting endpoints, with every write PATCH a no-op success — this suite never exercises the writes, only the rendered read-only/editable class split. */
function mockS04Fetch() {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === `${API_BASE_URL}/api/staff/assignable-users`) {
      return s04JsonResponse(200, []);
    }
    if (input === `${S04_TICKET_URL}/comments`) return s04JsonResponse(200, []);
    if (input === `${S04_TICKET_URL}/notes`) return s04JsonResponse(200, []);
    if (input === S04_TICKET_URL && init?.method === undefined) {
      return s04JsonResponse(200, s04Ticket());
    }
    return s04JsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const S04_STAFF_USER: AuthUser = {
  id: 9,
  name: "Jordan Lee",
  email: "jordan.lee@example.edu",
  role: "IT_STAFF",
  mustChangePassword: false,
};

function S04AuthBootstrap({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) setUser(S04_STAFF_USER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

function renderStaffTicketDetail() {
  return render(
    <AuthProvider>
      <S04AuthBootstrap>
        <MemoryRouter initialEntries={[`/staff/tickets/${S04_TICKET_ID}`]}>
          <Routes>
            <Route path="/staff/tickets/:id" element={<StaffTicketDetailScreen />} />
            <Route path="/staff/tickets" element={<h1>Ticket Queue</h1>} />
          </Routes>
        </MemoryRouter>
      </S04AuthBootstrap>
    </AuthProvider>,
  );
}

describe("S-04 editable vs read-only (ui-spec.md §10)", () => {
  it("read-only header fields carry the read-only field-value class; the operational panel's controls do not", async () => {
    mockS04Fetch();
    const { container } = renderStaffTicketDetail();
    await screen.findByText("TKT-2026-000055");

    // Read-only column: every StaticField/StaticBadgeField renders
    // .zen-staff-detail__field-value (StaffTicketDetailScreen.tsx's
    // StaticField/StaticBadgeField), and all of them live inside the
    // read-only column, never the operations card.
    const readonlyColumn = container.querySelector(".zen-staff-detail__readonly-column");
    expect(readonlyColumn).not.toBeNull();
    const readonlyValues = readonlyColumn!.querySelectorAll(".zen-staff-detail__field-value");
    // Ticket No., Ticket Date, Category, Requester, Requested Priority,
    // Related System, Summary, Description.
    expect(readonlyValues.length).toBe(8);

    // Operational panel: Ticket Owner (SelectField), IT Priority
    // (SegmentedControl), Status (SelectField) — none of these carry the
    // read-only class.
    const operationsCard = container.querySelector(".zen-staff-detail__card--operations");
    expect(operationsCard).not.toBeNull();
    expect(operationsCard!.querySelectorAll(".zen-staff-detail__field-value")).toHaveLength(0);

    // And the operational controls are genuinely present/interactive, so
    // the zero-count above isn't just an empty/unloaded panel.
    expect(within(operationsCard as HTMLElement).getByLabelText("Ticket Owner")).toBeInTheDocument();
    expect(within(operationsCard as HTMLElement).getByLabelText("IT Priority")).toBeInTheDocument();
    expect(within(operationsCard as HTMLElement).getByLabelText("Current Status")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S-05 (ui-spec.md §5/§6, V-08): validation placement — messages render
// inside their field wrapper, as in Lab 2 (FormField's `.zen-field`
// wrapper, shared unchanged from Lab 2 per ui-spec.md's own preamble).
// ---------------------------------------------------------------------------

function s05RenderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/" element={<h1>Landing</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

const S05_VOLUNTARY_USER: AuthUser = {
  id: 4,
  name: "Sam Rivera",
  email: "sam.rivera@example.edu",
  role: "REQUESTER",
  mustChangePassword: false,
};

function S05AuthBootstrap({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) setUser(S05_VOLUNTARY_USER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

function s05RenderChangePassword() {
  return render(
    <AuthProvider>
      <S05AuthBootstrap>
        <MemoryRouter initialEntries={["/change-password"]}>
          <Routes>
            <Route path="/change-password" element={<ChangePasswordScreen />} />
          </Routes>
        </MemoryRouter>
      </S05AuthBootstrap>
    </AuthProvider>,
  );
}

describe("S-05 validation placement (ui-spec.md §5/§6, Lab 2 placement)", () => {
  it("Login: an empty-field validation message renders inside its own .zen-field wrapper, alongside that field's label", async () => {
    s05RenderLogin();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    const emailAlert = await screen.findByText("Enter a valid email address.");
    expect(emailAlert).toHaveAttribute("role", "alert");
    const emailWrapper = emailAlert.closest(".zen-field");
    expect(emailWrapper).not.toBeNull();
    // The wrapper holding the message is the SAME wrapper that holds the
    // field's own label — not a page-level error list rendered elsewhere.
    expect(within(emailWrapper as HTMLElement).getByText("Email")).toBeInTheDocument();

    const passwordAlert = screen.getByText("Password is required.");
    const passwordWrapper = passwordAlert.closest(".zen-field");
    expect(passwordWrapper).not.toBeNull();
    expect(within(passwordWrapper as HTMLElement).getByText("Password")).toBeInTheDocument();

    // And the two wrappers are genuinely distinct fields, not one shared box.
    expect(emailWrapper).not.toBe(passwordWrapper);
  });

  it("Change Password: the confirm-mismatch message renders inside the Confirm field's own .zen-field wrapper", async () => {
    s05RenderChangePassword();
    await screen.findByLabelText(/current password/i);

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: "OldPassword1" },
    });
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: "BrandNewPassword1" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "SomethingElse1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));

    // There may be more than one role="alert" if other fields also error —
    // narrow to the one that actually mentions the mismatch.
    const alerts = await screen.findAllByRole("alert");
    const mismatch = alerts.find((el) => /match/i.test(el.textContent ?? ""));
    expect(mismatch).toBeTruthy();
    const wrapper = mismatch!.closest(".zen-field");
    expect(wrapper).not.toBeNull();
    expect(within(wrapper as HTMLElement).getByText("Confirm new password")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S-06 (ui-spec.md §8, V-07): private surface — `.thread--internal` itself
// uses --zen-private-bg and its border token. StaffTicketDetail.test.tsx
// already covers a narrower, DIFFERENT claim (the privacy badge's text
// colour under `.thread--internal .zen-message-thread__privacy-badge`) —
// this covers the wrapper class's own background/border, which is S-06's
// actual row.
// ---------------------------------------------------------------------------

describe("S-06 private surface (ui-spec.md §8)", () => {
  it(".thread--internal itself sets background to --zen-private-bg and a 2px --zen-private-border border", () => {
    const css = readCss("components/MessageThread.css");
    const block = /\.thread--internal\s*\{([^}]*)\}/.exec(css);
    expect(block, ".thread--internal rule not found in MessageThread.css").not.toBeNull();
    const body = block![1];
    expect(body).toMatch(/background:\s*var\(--zen-private-bg\)/);
    expect(body).toMatch(/border:\s*2px\s+solid\s+var\(--zen-private-border\)/);
  });

  it("does not contradict the narrower privacy-badge assertion: the badge's own text colour still resolves to --zen-private-text under .thread--internal", () => {
    const css = readCss("components/MessageThread.css");
    expect(css).toMatch(
      /\.thread--internal\s+\.zen-message-thread__privacy-badge\s*\{[^}]*color:\s*var\(--zen-private-text\)/,
    );
  });
});
