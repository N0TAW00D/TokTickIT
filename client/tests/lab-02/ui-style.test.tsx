import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { Button } from "../../src/components/Button.tsx";
import { FormField } from "../../src/components/FormField.tsx";
import { TextInput } from "../../src/components/TextInput.tsx";
import { SelectField } from "../../src/components/SelectField.tsx";
import { LoadingState } from "../../src/components/LoadingState.tsx";
import { EmptyState } from "../../src/components/EmptyState.tsx";
import { NoResultsState } from "../../src/components/NoResultsState.tsx";
import { ErrorState } from "../../src/components/ErrorState.tsx";
import { MyTicketsScreen } from "../../src/screens/MyTicketsScreen.tsx";
import { TicketDetailScreen } from "../../src/screens/TicketDetailScreen.tsx";
import {
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";

afterEach(() => {
  cleanup();
});

describe("Button variants", () => {
  it.each([
    ["primary", "zen-btn--primary"],
    ["secondary", "zen-btn--secondary"],
    ["tertiary", "zen-btn--tertiary"],
    ["destructive", "zen-btn--destructive"],
  ] as const)("applies the %s variant class", (variant, expectedClass) => {
    render(<Button variant={variant}>Action</Button>);

    const button = screen.getByRole("button", { name: "Action" });
    expect(button).toHaveClass("zen-btn");
    expect(button).toHaveClass(expectedClass);
  });
});

describe("Button disabled state", () => {
  it("cannot be activated and is marked disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Button busy state", () => {
  it("keeps its label, shows a spinner, and does not fire onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button busy onClick={onClick}>
        Submitting…
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Submitting…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".zen-btn__spinner")).not.toBeNull();

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Button computed attribute precedence", () => {
  it("does not let a caller-supplied aria-disabled/aria-busy contradict the real button state", () => {
    render(
      <Button aria-disabled={true} aria-busy={true}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("keeps the computed aria-disabled true even if the caller passes aria-disabled={false} while disabled", () => {
    render(
      <Button disabled aria-disabled={false}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});

describe("FormField required + error", () => {
  it("renders a required asterisk and associates the error message via aria-describedby", () => {
    render(
      <FormField
        id="summary"
        label="Ticket Summary"
        required
        error="Summary is required."
      >
        <TextInput />
      </FormField>,
    );

    const label = screen.getByText("Ticket Summary").closest("label");
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent("*");

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Summary is required.");
    expect(describedBy).toContain(alert.id);
  });

  it("merges a caller-supplied aria-describedby with the helper/error ids instead of overwriting it", () => {
    render(
      <FormField
        id="summary"
        label="Ticket Summary"
        helperText="Keep it under 140 characters."
        error="Summary is required."
      >
        <TextInput aria-describedby="external-note" />
      </FormField>,
    );

    const input = screen.getByRole("textbox");
    const describedBy = input.getAttribute("aria-describedby");

    // The caller-supplied id survives alongside the helper and error ids.
    expect(describedBy).toBe("external-note summary-helper summary-error");
  });

  it("turns the character counter error-colored past the max", () => {
    const { rerender, container } = render(
      <FormField id="summary" label="Ticket Summary" counter={{ current: 12, max: 140 }}>
        <TextInput />
      </FormField>,
    );

    expect(screen.getByText("12/140")).not.toHaveClass(
      "zen-field__counter--error",
    );

    rerender(
      <FormField id="summary" label="Ticket Summary" counter={{ current: 141, max: 140 }}>
        <TextInput />
      </FormField>,
    );

    expect(screen.getByText("141/140")).toHaveClass(
      "zen-field__counter--error",
    );
    expect(container.querySelectorAll(".zen-field__counter")).toHaveLength(1);
  });
});

describe("SelectField", () => {
  it("wraps a native select with a real associated label", () => {
    const onChange = vi.fn();
    render(
      <SelectField
        id="category"
        label="Category"
        value=""
        onChange={onChange}
        placeholder="Select…"
        options={[
          { value: "hardware", label: "Hardware" },
          { value: "network", label: "Network" },
        ]}
      />,
    );

    const select = screen.getByLabelText("Category") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");

    fireEvent.change(select, { target: { value: "network" } });

    expect(onChange).toHaveBeenCalledWith("network");
  });
});

describe("Read-only vs editable control styling", () => {
  it("gives a read-only TextInput a distinct class from an editable one", () => {
    render(
      <div>
        <TextInput aria-label="Editable field" value="editable" onChange={() => {}} />
        <TextInput aria-label="Read-only field" value="fixed" readOnly />
      </div>,
    );

    const editable = screen.getByLabelText("Editable field");
    const readOnly = screen.getByLabelText("Read-only field");

    expect(editable).not.toHaveClass("zen-input--readonly");
    expect(readOnly).toHaveClass("zen-input--readonly");
    expect(readOnly).toHaveAttribute("readonly");
  });
});

describe("LoadingState", () => {
  it("renders a polite status region with the loading text", () => {
    render(<LoadingState />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
  });
});

describe("EmptyState vs NoResultsState", () => {
  it("renders visibly distinct content for empty vs no-results", () => {
    const { unmount } = render(
      <EmptyState
        title="You haven't created any tickets yet."
        description="Create your first ticket to get started."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "You haven't created any tickets yet." }),
    ).toBeInTheDocument();

    unmount();

    const onClearFilters = vi.fn();
    render(
      <NoResultsState
        message="No tickets match your search or filters."
        onClearFilters={onClearFilters}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: /haven't created/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("No tickets match your search or filters."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorState", () => {
  it("renders an assertive alert with a working Retry action", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState message="Could not load tickets." onRetry={onRetry} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load tickets.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("pairs the message with a decorative warning glyph (ui-spec.md §12: color is never the sole signal)", () => {
    const { container } = render(<ErrorState message="Could not load tickets." />);

    const icon = container.querySelector(".zen-error-state__icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveTextContent("⚠");

    // The glyph is visible alongside the message, but hidden from assistive
    // tech so the role="alert" region announces only the message text.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("⚠");
    expect(alert.textContent).toContain("Could not load tickets.");
  });
});

// ---------------------------------------------------------------------------
// S-06 / S-07 (docs/lab-02/tests.md): badge consistency across surfaces, and
// icon-only controls (sort carets, paperclip) carrying an aria-label + title.
// ---------------------------------------------------------------------------

const API_BASE_URL = "http://localhost:3000";
const REQUESTER_ID = 1;
const TICKET_ID = 42;
const TICKET_NUMBER = "TKT-2026-000042";
const CATEGORY = { id: 4, name: "Network" };
const RELATED_SYSTEM = { id: 3, name: "VPN" };
const CREATED_AT = "2026-09-01T02:08:00.000Z";
const UPDATED_AT = "2026-09-01T02:45:00.000Z";

/**
 * One ticket, deliberately given `requestedPriority: "HIGH"` — the one
 * priority whose badge is styled with `--zen-error-bg`/`--zen-error`
 * (ui-spec.md §7.1) — so a test that only passed because a badge's text
 * happened to match its color can't hide here: "High" must read out and
 * markup must match across surfaces independent of that color.
 */
const S06_LIST_ITEM = {
  id: TICKET_ID,
  ticketNumber: TICKET_NUMBER,
  summary: "Cannot connect to VPN",
  category: CATEGORY,
  relatedSystem: RELATED_SYSTEM,
  requestedPriority: "HIGH",
  status: "NEW",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  activeAttachmentCount: 0,
};

const S06_DETAIL_TICKET = {
  id: TICKET_ID,
  ticketNumber: TICKET_NUMBER,
  requester: {
    id: REQUESTER_ID,
    name: "Jennifer Anderson",
    email: "jennifer.anderson@example.edu",
  },
  category: CATEGORY,
  relatedSystem: RELATED_SYSTEM,
  requestedPriority: "HIGH",
  status: "NEW",
  summary: "Cannot connect to VPN",
  description: "VPN client fails to establish a session.",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  attachments: [],
};

function s06JsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/**
 * Serves the one ticket above from all three endpoints the three surfaces
 * use: `GET /api/tickets` (list, desktop + mobile), `GET /api/categories`
 * (the list screen's controls bar), and `GET /api/tickets/:id` (detail).
 * The detail path is checked before the plain list path since
 * `/api/tickets/42` also starts with `/api/tickets`.
 */
function mockS06Fetch() {
  const fetchMock = vi.fn((input: string) => {
    if (input.startsWith(`${API_BASE_URL}/api/tickets/${TICKET_ID}`)) {
      return s06JsonResponse(200, S06_DETAIL_TICKET);
    }
    if (input.startsWith(`${API_BASE_URL}/api/tickets`)) {
      return s06JsonResponse(200, {
        items: [S06_LIST_ITEM],
        meta: {
          page: 1,
          pageSize: 10,
          totalItems: 1,
          totalPages: 1,
          sort: "createdAt",
          order: "desc",
        },
      });
    }
    if (input.startsWith(`${API_BASE_URL}/api/categories`)) {
      return s06JsonResponse(200, [CATEGORY]);
    }
    return s06JsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** jsdom has no `window.matchMedia`; mirrors MyTickets.test.tsx's stub. */
function stubMatchMedia(matches: boolean) {
  const mediaQueryList = {
    matches,
    media: "",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mediaQueryList));
}

/** Seeds RequesterContext the way a real Continue click would, mirroring
 * MyTickets.test.tsx / RequesterTicketDetail.test.tsx's identical helper,
 * so screens can render directly without RequireRequester. */
function S06Bootstrap({ children }: { children: ReactNode }) {
  const { requesterName, selectRequester } = useRequester();

  useEffect(() => {
    if (requesterName === null) {
      selectRequester({ id: REQUESTER_ID, name: "Jennifer Anderson" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (requesterName === null) return null;

  return <>{children}</>;
}

function renderMyTickets(desktop: boolean) {
  stubMatchMedia(desktop);
  return render(
    <RequesterProvider>
      <S06Bootstrap>
        <MemoryRouter initialEntries={["/tickets"]}>
          <Routes>
            <Route path="/tickets" element={<MyTicketsScreen />} />
            <Route path="/tickets/:id" element={<h1>detail stub</h1>} />
          </Routes>
        </MemoryRouter>
      </S06Bootstrap>
    </RequesterProvider>,
  );
}

function renderTicketDetail() {
  return render(
    <RequesterProvider>
      <S06Bootstrap>
        <MemoryRouter initialEntries={[`/tickets/${TICKET_ID}`]}>
          <Routes>
            <Route path="/tickets/:id" element={<TicketDetailScreen />} />
          </Routes>
        </MemoryRouter>
      </S06Bootstrap>
    </RequesterProvider>,
  );
}

describe("S-06 badge consistency across list, card, and detail (ui-spec.md §7, AC-41)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("renders the same PriorityBadge/StatusBadge markup and text label for the same ticket in the desktop table, mobile card, and detail screen", async () => {
    mockS06Fetch();

    // --- Desktop table (My Tickets, ≥768px) ---
    const desktop = renderMyTickets(true);
    await screen.findByRole("table");
    const desktopPriority = desktop.container.querySelector(
      ".zen-badge--priority-high",
    );
    const desktopStatus = desktop.container.querySelector(
      ".zen-badge--status-new",
    );
    expect(desktopPriority).not.toBeNull();
    expect(desktopStatus).not.toBeNull();
    // The text label reads out on its own, independent of the color-carrying
    // class name and of the decorative (aria-hidden) icon glyph (ui-spec.md
    // §12 / §7: "never color alone").
    expect(
      desktopPriority!.querySelector(".zen-badge__label")!.textContent,
    ).toBe("High");
    expect(
      desktopStatus!.querySelector(".zen-badge__label")!.textContent,
    ).toBe("New");
    const desktopPriorityHtml = desktopPriority!.outerHTML;
    const desktopStatusHtml = desktopStatus!.outerHTML;
    desktop.unmount();
    cleanup();

    // --- Mobile card (My Tickets, <768px) ---
    mockS06Fetch();
    const card = renderMyTickets(false);
    await screen.findByRole("list");
    const cardPriority = card.container.querySelector(
      ".zen-badge--priority-high",
    );
    const cardStatus = card.container.querySelector(".zen-badge--status-new");
    expect(cardPriority).not.toBeNull();
    expect(cardStatus).not.toBeNull();
    expect(cardPriority!.outerHTML).toBe(desktopPriorityHtml);
    expect(cardStatus!.outerHTML).toBe(desktopStatusHtml);
    card.unmount();
    cleanup();

    // --- Ticket Detail ---
    mockS06Fetch();
    const detail = renderTicketDetail();
    await screen.findByText(TICKET_NUMBER);
    const detailPriority = detail.container.querySelector(
      ".zen-badge--priority-high",
    );
    const detailStatus = detail.container.querySelector(
      ".zen-badge--status-new",
    );
    expect(detailPriority).not.toBeNull();
    expect(detailStatus).not.toBeNull();
    expect(detailPriority!.outerHTML).toBe(desktopPriorityHtml);
    expect(detailStatus!.outerHTML).toBe(desktopStatusHtml);
  });
});

