import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

// Lab 4 UI style rows (docs/lab-04/tests.md §2.8), dashboard parts: S-01 (token
// discipline for the dashboard CSS and its new token) and S-03 (the
// needs-attention accent always comes with sub-label text). Technique follows
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
