import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { CreateTicketScreen } from "../../src/screens/CreateTicketScreen.tsx";
import {
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";

// Covers docs/lab-02/tests.md rows C-09 through C-14. Attachments (C-15,
// C-16, C-17) belong to the AttachmentUploader built in Issue #17 — this
// screen only renders the placeholder section from ui-spec.md §8.

const API_BASE_URL = "http://localhost:3000";
const CATEGORIES_URL = `${API_BASE_URL}/api/categories`;
const RELATED_SYSTEMS_URL = `${API_BASE_URL}/api/related-systems`;
const TICKETS_URL = `${API_BASE_URL}/api/tickets`;

const CATEGORIES = [
  { id: 1, name: "Hardware" },
  { id: 2, name: "Software" },
];

const RELATED_SYSTEMS = [
  { id: 10, name: "Email" },
  { id: 20, name: "Campus Wi-Fi" },
];

const SUMMARY_TEXT = "Laptop battery drains quickly at odd times";
const DESCRIPTION_TEXT =
  "The laptop battery drains far faster than it used to, even when idle.";

const SUCCESS_TICKET = {
  id: 42,
  ticketNumber: "TKT-2026-000001",
  requester: {
    id: 1,
    name: "Jennifer Anderson",
    email: "jennifer.anderson@example.edu",
  },
  category: { id: 1, name: "Hardware" },
  relatedSystem: { id: 10, name: "Email" },
  requestedPriority: "MEDIUM",
  status: "NEW",
  summary: SUMMARY_TEXT,
  description: DESCRIPTION_TEXT,
  createdAt: "2026-09-01T08:14:00.000Z",
  updatedAt: "2026-09-01T08:14:00.000Z",
  attachments: [],
};

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

interface MockFetchOptions {
  categories?: () => Promise<Response>;
  relatedSystems?: () => Promise<Response>;
  createTicket?: () => Promise<Response>;
}

function mockFetch({
  categories,
  relatedSystems,
  createTicket,
}: MockFetchOptions = {}) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === CATEGORIES_URL) {
      return (categories ?? (() => jsonResponse(200, CATEGORIES)))();
    }
    if (input === RELATED_SYSTEMS_URL) {
      return (relatedSystems ?? (() => jsonResponse(200, RELATED_SYSTEMS)))();
    }
    if (input === TICKETS_URL && init?.method === "POST") {
      return (createTicket ?? (() => jsonResponse(201, SUCCESS_TICKET)))();
    }
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function postCallCount(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(
    ([url, init]: [string, RequestInit?]) =>
      url === TICKETS_URL && init?.method === "POST",
  ).length;
}

/**
 * Seeds the RequesterContext the same way a real Continue click / route
 * guard pass would, so CreateTicketScreen can be rendered directly without
 * depending on RequireRequester or the selection screen (mirrors the
 * Bootstrap idiom in AppShell.test.tsx).
 */
function Bootstrap({ children }: { children: ReactNode }) {
  const { requesterName, selectRequester } = useRequester();

  useEffect(() => {
    if (requesterName === null) {
      selectRequester({ id: 1, name: "Jennifer Anderson" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (requesterName === null) return null;

  return <>{children}</>;
}

function renderScreen() {
  return render(
    <RequesterProvider>
      <Bootstrap>
        <MemoryRouter initialEntries={["/tickets/new"]}>
          <Routes>
            <Route path="/tickets/new" element={<CreateTicketScreen />} />
            <Route path="/tickets" element={<h1>My Tickets</h1>} />
            <Route path="/tickets/:id" element={<h1>Ticket Details</h1>} />
          </Routes>
        </MemoryRouter>
      </Bootstrap>
    </RequesterProvider>,
  );
}

async function fillValidForm() {
  await screen.findByLabelText(/category/i);
  fireEvent.change(screen.getByLabelText(/category/i), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText(/related system/i), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText(/ticket summary/i), {
    target: { value: SUMMARY_TEXT },
  });
  fireEvent.change(screen.getByLabelText(/^description/i), {
    target: { value: DESCRIPTION_TEXT },
  });
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

describe("C-09 create form loads reference data", () => {
  it("shows a loading indicator and disables Submit while reference data is pending", () => {
    mockFetch({ categories: () => new Promise(() => {}) });

    renderScreen();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /submit ticket/i }),
    ).toBeDisabled();
  });

  it("shows an ErrorState with Retry and keeps Submit disabled on a reference-data failure", async () => {
    mockFetch({ categories: () => Promise.reject(new Error("network down")) });

    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /submit ticket/i }),
    ).toBeDisabled();
  });

  it("populates Category/Related System from the API and shows the Requester read-only", async () => {
    mockFetch();

    renderScreen();

    const categorySelect = await screen.findByLabelText(/category/i);
    expect(categorySelect).toHaveDisplayValue("Select…");
    expect(
      (categorySelect as HTMLSelectElement).options,
    ).toHaveLength(CATEGORIES.length + 1);
    CATEGORIES.forEach((category) => {
      expect(screen.getByText(category.name)).toBeInTheDocument();
    });

    const relatedSystemSelect = screen.getByLabelText(/related system/i);
    RELATED_SYSTEMS.forEach((system) => {
      expect(screen.getByText(system.name)).toBeInTheDocument();
    });
    expect(relatedSystemSelect).toBeInTheDocument();

    const prioritySelect = screen.getByLabelText(/requested priority/i);
    expect(prioritySelect).toHaveValue("MEDIUM");

    const requesterField = screen.getByLabelText(/^requester/i);
    expect(requesterField).toHaveValue("Jennifer Anderson");
    expect(requesterField).toHaveAttribute("readonly");

    expect(
      screen.getByRole("button", { name: /submit ticket/i }),
    ).toBeEnabled();
  });
});

describe("C-10 create validation — empty summary", () => {
  it("shows a field message under Summary, focuses it, and sends no create request", async () => {
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByLabelText(/category/i);
    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/related system/i), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText(/^description/i), {
      target: { value: DESCRIPTION_TEXT },
    });
    // Summary left empty.

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    expect(
      await screen.findByText("Summary must be between 5 and 140 characters."),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByLabelText(/ticket summary/i),
    );

    expect(postCallCount(fetchMock)).toBe(0);
  });
});

describe("C-11 create validation — lengths", () => {
  it("shows length messages for Summary 4/141 and Description 19, and sends no create request", async () => {
    const fetchMock = mockFetch();
    renderScreen();

    await screen.findByLabelText(/category/i);
    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/related system/i), {
      target: { value: "10" },
    });

    fireEvent.change(screen.getByLabelText(/ticket summary/i), {
      target: { value: "Abcd" }, // 4 chars
    });
    fireEvent.change(screen.getByLabelText(/^description/i), {
      target: { value: "1234567890123456789" }, // 19 chars
    });

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    expect(
      await screen.findByText("Summary must be between 5 and 140 characters."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Description must be between 20 and 5000 characters."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/ticket summary/i), {
      target: { value: "a".repeat(141) }, // 141 chars
    });
    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    expect(
      await screen.findByText("Summary must be between 5 and 140 characters."),
    ).toBeInTheDocument();

    expect(postCallCount(fetchMock)).toBe(0);
  });
});

describe("C-12 create busy state", () => {
  it("shows Submit as busy and disabled while the request is pending", async () => {
    let resolveCreate!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    mockFetch({ createTicket: () => pending });

    renderScreen();
    await fillValidForm();

    const submitButton = screen.getByRole("button", { name: /submit ticket/i });
    fireEvent.click(submitButton);

    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveAttribute("aria-busy", "true");

    resolveCreate({
      ok: true,
      status: 201,
      json: () => Promise.resolve(SUCCESS_TICKET),
    } as Response);

    await screen.findByRole("status");
  });

  it("fires only one POST /api/tickets when two submits land in the same tick (BR-24)", async () => {
    let resolveCreate!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    const fetchMock = mockFetch({ createTicket: () => pending });

    const { container } = renderScreen();
    await fillValidForm();

    const form = container.querySelector("form") as HTMLFormElement;

    // Both submits are dispatched inside one `act` so React does not get a
    // chance to re-render (and disable the button) between them — this is
    // the actual race BR-24 guards against, not just a slow double-click.
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(postCallCount(fetchMock)).toBe(1);

    resolveCreate({
      ok: true,
      status: 201,
      json: () => Promise.resolve(SUCCESS_TICKET),
    } as Response);

    await screen.findByRole("status");
  });
});

describe("C-13 create success", () => {
  it("shows the returned ticket number with View ticket / Create another actions", async () => {
    mockFetch({ createTicket: () => jsonResponse(201, SUCCESS_TICKET) });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const panel = await screen.findByRole("status");
    expect(panel).toHaveTextContent(SUCCESS_TICKET.ticketNumber);
    expect(
      screen.getByRole("button", { name: /view ticket/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create another/i }),
    ).toBeInTheDocument();
  });

  it("Create another resets the form to its initial state", async () => {
    mockFetch({ createTicket: () => jsonResponse(201, SUCCESS_TICKET) });
    renderScreen();
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: /create another/i }));

    expect(await screen.findByLabelText(/ticket summary/i)).toHaveValue("");
    expect(screen.getByLabelText(/^description/i)).toHaveValue("");
    expect(screen.getByLabelText(/requested priority/i)).toHaveValue(
      "MEDIUM",
    );
  });

  it("View ticket navigates to /tickets/:id", async () => {
    mockFetch({ createTicket: () => jsonResponse(201, SUCCESS_TICKET) });
    renderScreen();
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: /view ticket/i }));

    expect(
      await screen.findByRole("heading", { name: /ticket details/i }),
    ).toBeInTheDocument();
  });
});

describe("C-14 create API failure", () => {
  it("shows a safe error, preserves every entered value, and re-enables Submit", async () => {
    mockFetch({ createTicket: () => Promise.reject(new Error("network down")) });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not create the ticket. Please check your connection and try again.",
    );

    expect(screen.getByLabelText(/category/i)).toHaveValue("1");
    expect(screen.getByLabelText(/related system/i)).toHaveValue("10");
    expect(screen.getByLabelText(/ticket summary/i)).toHaveValue(
      SUMMARY_TEXT,
    );
    expect(screen.getByLabelText(/^description/i)).toHaveValue(
      DESCRIPTION_TEXT,
    );

    expect(
      screen.getByRole("button", { name: /submit ticket/i }),
    ).toBeEnabled();
  });
});

// Covers the PR #29 review fix: createTicket() used to discard the response
// body on failure, so a 400 VALIDATION_FAILED (api-spec.md §1.3, §3.1) was
// indistinguishable from a dead backend. No tests.md row owns this path —
// names below are descriptive rather than a new C-xx id.
describe("create API failure — server-side VALIDATION_FAILED (fields[])", () => {
  it("renders the server's field messages under the named fields, focuses the first one, hides the generic ErrorState, preserves values, and re-enables Submit", async () => {
    const fetchMock = mockFetch({
      createTicket: () =>
        jsonResponse(400, {
          error: "VALIDATION_FAILED",
          message: "One or more fields are invalid.",
          fields: [
            {
              field: "summary",
              message: "Summary must be between 5 and 140 characters.",
            },
            {
              field: "description",
              message: "Description must be between 20 and 5000 characters.",
            },
          ],
        }),
    });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    expect(
      await screen.findByText("Summary must be between 5 and 140 characters."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Description must be between 20 and 5000 characters."),
    ).toBeInTheDocument();

    expect(document.activeElement).toBe(
      screen.getByLabelText(/ticket summary/i),
    );

    // Field-level errors also render with role="alert" (FormField), so the
    // generic ErrorState's absence is checked by its own text, not by role.
    expect(
      screen.queryByText(
        "Could not create the ticket. Please check your connection and try again.",
      ),
    ).not.toBeInTheDocument();

    expect(screen.getByLabelText(/category/i)).toHaveValue("1");
    expect(screen.getByLabelText(/related system/i)).toHaveValue("10");
    expect(screen.getByLabelText(/ticket summary/i)).toHaveValue(
      SUMMARY_TEXT,
    );
    expect(screen.getByLabelText(/^description/i)).toHaveValue(
      DESCRIPTION_TEXT,
    );

    expect(
      screen.getByRole("button", { name: /submit ticket/i }),
    ).toBeEnabled();
    expect(postCallCount(fetchMock)).toBe(1);
  });

  it("surfaces a server field name with no matching form field in the generic error area instead of dropping it", async () => {
    mockFetch({
      createTicket: () =>
        jsonResponse(400, {
          error: "VALIDATION_FAILED",
          message: "One or more fields are invalid.",
          fields: [
            { field: "somethingUnexpected", message: "Unexpected server field." },
          ],
        }),
    });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unexpected server field.");

    expect(screen.getByLabelText(/ticket summary/i)).toHaveValue(
      SUMMARY_TEXT,
    );
    expect(
      screen.getByRole("button", { name: /submit ticket/i }),
    ).toBeEnabled();
  });
});

describe("create API failure — generic path is unaffected", () => {
  it("shows the generic ErrorState with no field messages on a 500", async () => {
    mockFetch({
      createTicket: () =>
        jsonResponse(500, { error: "INTERNAL", message: "Something broke." }),
    });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not create the ticket. Please check your connection and try again.",
    );
    expect(screen.queryByText(/must be between/i)).not.toBeInTheDocument();
  });

  it("shows the generic ErrorState with no field messages on a network rejection", async () => {
    mockFetch({
      createTicket: () => Promise.reject(new Error("network down")),
    });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not create the ticket. Please check your connection and try again.",
    );
    expect(screen.queryByText(/must be between/i)).not.toBeInTheDocument();
  });

  it("falls back to the generic error, without throwing, when a 400 body is not valid JSON", async () => {
    mockFetch({
      createTicket: () =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.reject(new Error("not json")),
        } as unknown as Response),
    });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not create the ticket. Please check your connection and try again.",
    );
    expect(screen.getByLabelText(/ticket summary/i)).toHaveValue(
      SUMMARY_TEXT,
    );
    expect(
      screen.getByRole("button", { name: /submit ticket/i }),
    ).toBeEnabled();
  });

  it("falls back to the generic error when a 400 body has no fields[] (e.g. MISSING_REQUESTER)", async () => {
    mockFetch({
      createTicket: () =>
        jsonResponse(400, {
          error: "MISSING_REQUESTER",
          message: "X-Requester-Id is required.",
        }),
    });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not create the ticket. Please check your connection and try again.",
    );
    expect(screen.queryByText(/must be between/i)).not.toBeInTheDocument();
  });
});

// api-spec.md §1.2/§3.1: POST /api/tickets is Requester-scoped via
// X-Requester-Id, not the request body. No tests.md row asserts this
// header directly — without it every create would 400 MISSING_REQUESTER
// server-side, a failure this suite would otherwise never catch.
describe("createTicket sends X-Requester-Id (api-spec.md §1.2, §3.1)", () => {
  it("includes the caller's Requester id header on POST /api/tickets", async () => {
    const fetchMock = mockFetch({
      createTicket: () => jsonResponse(201, SUCCESS_TICKET),
    });
    renderScreen();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));
    await screen.findByRole("status");

    const postCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit?]) =>
        url === TICKETS_URL && init?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const [, init] = postCall as [string, RequestInit];
    expect(init.headers).toMatchObject({ "X-Requester-Id": "1" });
  });
});
