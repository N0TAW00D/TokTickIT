import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { StaffTicketDetailScreen } from "../../src/screens/StaffTicketDetailScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";
import {
  formatDateTime,
  formatDateTimeWithYear,
} from "../../src/tickets/formatDateTime.ts";
import type { TicketDetailResponse } from "../../src/tickets/api.ts";

// Issue #72 dispatch scope: screen-level states (loading/loaded/not-found/
// error), read-only field rendering, Attachments (download/preview, no
// remove/upload), and both MessageThread threads (Public Comments +
// Internal Notes) being present and wired to the right endpoints. The
// editable Owner/IT-Priority/Status controls (StaffTicketDetailScreen.tsx's
// "Ticket Operations" card) are a separate dispatch's territory and are
// deliberately not exercised here beyond letting them render (they always
// mount, so every test below also stubs `GET /api/staff/assignable-users`
// to keep that card's own fetch from ever surfacing as a console error).
//
// Auth seeding follows StaffTicketQueue.test.tsx's own `AuthBootstrap`
// pattern (the screen calls `useAuth()` directly), and route rendering
// follows the same `MemoryRouter`/`Routes` harness that file and
// RequesterTicketDetail.test.tsx already use.

const API_BASE_URL = "http://localhost:3000";
const TICKET_ID = 21;
const TICKET_URL = `${API_BASE_URL}/api/tickets/${TICKET_ID}`;
const ASSIGNABLE_URL = `${API_BASE_URL}/api/staff/assignable-users`;
const COMMENTS_URL = `${API_BASE_URL}/api/tickets/${TICKET_ID}/comments`;
const NOTES_URL = `${API_BASE_URL}/api/tickets/${TICKET_ID}/notes`;

function downloadUrl(id: number): string {
  return `${API_BASE_URL}/api/attachments/${id}/download`;
}

const ATTACHMENTS = [
  {
    id: 1,
    originalFilename: "battery-report.pdf",
    mimeType: "application/pdf",
    fileSize: 249184,
    isRemoved: false,
    removedAt: null,
    removedReason: null,
    createdAt: "2026-09-01T08:15:10.000Z",
  },
  {
    id: 2,
    originalFilename: "photo.png",
    mimeType: "image/png",
    fileSize: 819200,
    isRemoved: false,
    removedAt: null,
    removedReason: null,
    createdAt: "2026-09-01T08:16:00.000Z",
  },
  {
    id: 3,
    originalFilename: "screenshot.png",
    mimeType: "image/png",
    fileSize: 512000,
    isRemoved: true,
    removedAt: "2026-09-01T02:02:00.000Z",
    removedReason: "Wrong screenshot",
    createdAt: "2026-09-01T08:17:00.000Z",
  },
];

function baseTicket(
  overrides: Record<string, unknown> = {},
): TicketDetailResponse {
  return {
    id: TICKET_ID,
    ticketNumber: "TKT-2026-000021",
    requester: {
      id: 7,
      name: "Jennifer Anderson",
      email: "jennifer.anderson@example.edu",
    },
    category: { id: 4, name: "Network" },
    relatedSystem: { id: 7, name: "Corporate Laptop" },
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    status: "OPEN",
    owner: { id: 9, name: "Jordan Lee" },
    requesterResolvedAt: null,
    summary: "Printer not connecting to network",
    description: "The printer disconnects from the network every few minutes.",
    createdAt: "2026-09-01T08:14:00.000Z",
    updatedAt: "2026-09-05T09:30:00.000Z",
    attachments: ATTACHMENTS,
    ...overrides,
  } as TicketDetailResponse;
}

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Same shape as AttachmentSection.test.tsx's own `blobResponse` stand-in. */
function blobResponse(
  status: number,
  {
    body = new Blob(["file-bytes"], { type: "application/pdf" }),
    contentDisposition,
    jsonBody,
  }: { body?: Blob; contentDisposition?: string; jsonBody?: unknown } = {},
): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    blob: () => Promise.resolve(body),
    json: () => Promise.resolve(jsonBody ?? {}),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-disposition"
          ? (contentDisposition ?? null)
          : null,
    },
  } as unknown as Response);
}

interface MockOptions {
  ticket?: () => Promise<Response>;
  comments?: unknown[];
  notes?: unknown[];
  postComment?: (init?: RequestInit) => Promise<Response>;
  postNote?: (init?: RequestInit) => Promise<Response>;
  download?: (id: number) => Promise<Response>;
}

function mockFetch({
  ticket,
  comments = [],
  notes = [],
  postComment,
  postNote,
  download,
}: MockOptions = {}) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === ASSIGNABLE_URL) return jsonResponse(200, []);
    if (input === TICKET_URL && init?.method === undefined) {
      return (ticket ?? (() => jsonResponse(200, baseTicket())))();
    }
    if (input === COMMENTS_URL) {
      if (init?.method === "POST") {
        return (postComment ?? (() => jsonResponse(201, {})))(init);
      }
      return jsonResponse(200, comments);
    }
    if (input === NOTES_URL) {
      if (init?.method === "POST") {
        return (postNote ?? (() => jsonResponse(201, {})))(init);
      }
      return jsonResponse(200, notes);
    }
    const downloadMatch = /\/attachments\/(\d+)\/download$/.exec(input);
    if (downloadMatch) {
      return (download ?? (() => blobResponse(200, {})))(Number(downloadMatch[1]));
    }
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const IT_STAFF_USER: AuthUser = {
  id: 9,
  name: "Jordan Lee",
  email: "jordan.lee@example.edu",
  role: "IT_STAFF",
  mustChangePassword: false,
};

const ADMIN_USER: AuthUser = {
  id: 15,
  name: "Casey Morgan",
  email: "casey.morgan@example.edu",
  role: "ADMINISTRATOR",
  mustChangePassword: false,
};

/** Seeds AuthContext before the screen mounts (StaffTicketQueue.test.tsx's own pattern) — the screen calls `useAuth()` directly, so it must never mount without this. */
function AuthBootstrap({
  children,
  seedUser,
}: {
  children: ReactNode;
  seedUser: AuthUser;
}) {
  const { user, setUser } = useAuth();
  useEffect(() => {
    if (!user) setUser(seedUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

function renderScreen({
  user = IT_STAFF_USER,
  path = `/staff/tickets/${TICKET_ID}`,
}: { user?: AuthUser; path?: string } = {}) {
  return render(
    <AuthProvider>
      <AuthBootstrap seedUser={user}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/staff/tickets/:id"
              element={<StaffTicketDetailScreen />}
            />
            <Route path="/staff/tickets" element={<h1>Ticket Queue</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

/** jsdom has no object-URL support — stub it so the download/preview wiring can run (AttachmentSection.test.tsx's own helper). */
function installObjectUrlStub() {
  const created: Blob[] = [];
  const revoked: string[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      created.push(blob);
      return `blob:mock/${created.length}`;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn((url: string) => {
      revoked.push(url);
    }),
  });
  return { created, revoked };
}

/** The ticket-information card is the first `.zen-staff-detail__card` in the DOM — the Operations and Attachments cards share the same base class, so scoping to this element keeps field assertions unambiguous. */
function infoCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector(".zen-staff-detail__card");
  if (!card) throw new Error("ticket information card did not render");
  return card as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Loading state", () => {
  it("shows a role=status loading indicator while the initial fetch is in flight", () => {
    mockFetch({ ticket: () => new Promise(() => {}) });
    renderScreen();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("TKT-2026-000021")).not.toBeInTheDocument();
  });
});

describe("Loaded state — read-only fields", () => {
  it("renders Ticket No./Date/Category/Requester/Requested Priority/Related System/Summary/Description from the mocked response", async () => {
    const fetchMock = mockFetch();
    const { container } = renderScreen();

    await screen.findByText("TKT-2026-000021");
    const detail = within(infoCard(container));

    expect(detail.getByText("TKT-2026-000021")).toBeInTheDocument();
    expect(
      detail.getByText(formatDateTimeWithYear("2026-09-01T08:14:00.000Z")),
    ).toBeInTheDocument();
    expect(detail.getByText("Network")).toBeInTheDocument();
    expect(detail.getByText("Jennifer Anderson")).toBeInTheDocument();
    expect(detail.getByText("Medium")).toBeInTheDocument();
    expect(detail.getByText("Corporate Laptop")).toBeInTheDocument();
    expect(
      detail.getByText("Printer not connecting to network"),
    ).toBeInTheDocument();
    expect(
      detail.getByText(
        "The printer disconnects from the network every few minutes.",
      ),
    ).toBeInTheDocument();

    // Route wiring sanity: the :id param round-trips into the fetch, with
    // the session cookie included (api-spec.md §5's shared auth convention).
    expect(fetchMock).toHaveBeenCalledWith(
      TICKET_URL,
      expect.objectContaining({ credentials: "include" }),
    );
  });
});

describe("Resolution indication", () => {
  it("shows the third-person resolved note when requesterResolvedAt is set", async () => {
    mockFetch({
      ticket: () =>
        jsonResponse(
          200,
          baseTicket({ requesterResolvedAt: "2026-09-02T03:15:00.000Z" }),
        ),
    });
    renderScreen();

    await screen.findByText("TKT-2026-000021");
    const note = await screen.findByText(
      /the requester reported this looks resolved on/i,
    );
    expect(note).toHaveTextContent(formatDateTime("2026-09-02T03:15:00.000Z"));
  });

  it("does not show the resolved note when requesterResolvedAt is null", async () => {
    mockFetch();
    renderScreen();

    await screen.findByText("TKT-2026-000021");
    expect(screen.queryByText(/looks resolved on/i)).not.toBeInTheDocument();
  });
});

describe("Not-found state", () => {
  it("shows the not-found UI with a working Back to Ticket Queue action", async () => {
    mockFetch({ ticket: () => jsonResponse(404, { error: "NOT_FOUND" }) });
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Ticket not found" }),
    ).toBeInTheDocument();
    expect(screen.getByText("This ticket doesn't exist.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const backButton = screen.getByRole("button", {
      name: /back to ticket queue/i,
    });
    fireEvent.click(backButton);

    expect(
      await screen.findByRole("heading", { name: "Ticket Queue" }),
    ).toBeInTheDocument();
  });
});

describe("Error/failure state", () => {
  it("shows the ErrorState with Retry on a network failure; Retry re-fetches and recovers", async () => {
    const fetchMock = mockFetch({
      ticket: () => Promise.reject(new Error("network down")),
    });
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not load this ticket. Please check your connection and try again.",
    );
    expect(screen.queryByText("TKT-2026-000021")).not.toBeInTheDocument();

    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (input === ASSIGNABLE_URL) return jsonResponse(200, []);
      if (input === TICKET_URL && init?.method === undefined) {
        return jsonResponse(200, baseTicket());
      }
      if (input === COMMENTS_URL) return jsonResponse(200, []);
      if (input === NOTES_URL) return jsonResponse(200, []);
      return jsonResponse(404, {});
    });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await screen.findByText("TKT-2026-000021");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the same failure state on a 500 response", async () => {
    mockFetch({ ticket: () => jsonResponse(500, { error: "INTERNAL" }) });
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not load this ticket. Please check your connection and try again.",
    );
  });
});

describe("Attachments — read-only (no upload, no remove)", () => {
  it("renders every attachment row, with Download on active rows, Preview only on the image, and no upload control", async () => {
    mockFetch();
    renderScreen();

    await screen.findByText("TKT-2026-000021");

    // All three rows render, including the removed one, with no upload
    // control anywhere on this screen (ui-spec.md §10: "download only — no
    // upload, no removal").
    expect(screen.getByText("battery-report.pdf")).toBeInTheDocument();
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    expect(screen.queryByLabelText(/attachment files/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add files/i })).not.toBeInTheDocument();

    // Download: PDF + active image only (the removed row gets no controls
    // at all, per AttachmentList's own BR-33 handling).
    expect(
      screen.getAllByRole("button", { name: /^download$/i }),
    ).toHaveLength(2);

    // Preview: active image only, never the PDF or the removed row.
    expect(
      screen.getAllByRole("button", { name: /^preview$/i }),
    ).toHaveLength(1);
  });

  // KNOWN BUG, tracked via `it.fails` rather than papered over — a real
  // regression this dispatch's job was to surface, not hide (test-only
  // dispatch: fixing it is out of scope; see this file's own header
  // comment). This screen's own doc comment claims that passing
  // AttachmentList only `onDownload`/`onPreview` (omitting `onRemove`)
  // "naturally hides that button". It does not: AttachmentList.tsx's
  // ActiveRow renders the destructive Remove button unconditionally on
  // every active row regardless of whether `onRemove` is wired — confirmed
  // by AttachmentSection.test.tsx's own already-passing C-21 case, which
  // renders `<AttachmentList>` with no `onRemove` prop at all and asserts
  // the Remove button IS present. So IT Staff currently sees an inert but
  // visible destructive "Remove" control on every active attachment row on
  // this screen, contradicting ui-spec.md §10's "download only — no
  // upload, no removal". `it.fails` keeps this assertion written to the
  // correct, spec-mandated behavior (never adjusted to match the current
  // buggy output) while keeping the suite green; the day a fix lands this
  // wrapper will itself start failing (an "unexpectedly passed" error),
  // which is the prompt to flip it back to a plain `it`.
  it.fails("shows no Remove control anywhere in the attachment list (ui-spec.md §10)", async () => {
    mockFetch();
    renderScreen();

    await screen.findByText("TKT-2026-000021");
    expect(
      screen.queryAllByRole("button", { name: /^remove$/i }),
    ).toHaveLength(0);
  });

  it("Download fetches the bytes and saves them (session cookie included)", async () => {
    installObjectUrlStub();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const fetchMock = mockFetch({
      download: (id) =>
        blobResponse(200, {
          contentDisposition: `attachment; filename="attachment-${id}"`,
        }),
    });
    renderScreen();

    await screen.findByText("TKT-2026-000021");
    const downloadButtons = screen.getAllByRole("button", {
      name: /^download$/i,
    });
    fireEvent.click(downloadButtons[0]);

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      downloadUrl(1),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("Preview opens the lightbox and shows the fetched image (session cookie included)", async () => {
    installObjectUrlStub();
    const fetchMock = mockFetch({
      download: () => blobResponse(200, { body: new Blob(["img"], { type: "image/png" }) }),
    });
    renderScreen();

    await screen.findByText("TKT-2026-000021");
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("photo.png");
    await within(dialog).findByRole("img", { name: "photo.png" });
    expect(fetchMock).toHaveBeenCalledWith(
      downloadUrl(2),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("surfaces a download failure without crashing (attachment removed mid-session, 410)", async () => {
    installObjectUrlStub();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mockFetch({
      download: () =>
        blobResponse(410, {
          jsonBody: {
            error: "ATTACHMENT_REMOVED",
            message: "This attachment has been removed.",
          },
        }),
    });
    renderScreen();

    await screen.findByText("TKT-2026-000021");
    fireEvent.click(screen.getAllByRole("button", { name: /^download$/i })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /was removed and can no longer be downloaded/i,
    );
  });
});

describe("Public Comments thread (variant=public)", () => {
  it('renders the "Comments" heading and a posted comment body; posting calls POST and appends the new comment', async () => {
    const fetchMock = mockFetch({
      comments: [
        {
          id: 1,
          body: "Checked cabling, looks fine.",
          createdAt: "2026-09-01T09:10:00.000Z",
          author: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
        },
      ],
      postComment: (init) => {
        const { body } = JSON.parse((init?.body as string) ?? "{}");
        return jsonResponse(201, {
          id: 2,
          body,
          createdAt: "2026-09-02T10:00:00.000Z",
          author: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
        });
      },
    });
    renderScreen();

    await screen.findByText("TKT-2026-000021");
    expect(
      await screen.findByRole("heading", { name: "Comments" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Checked cabling, looks fine."),
    ).toBeInTheDocument();

    const textarea = screen.getByLabelText(/add a comment/i);
    fireEvent.change(textarea, {
      target: { value: "Following up with the vendor." },
    });
    fireEvent.click(screen.getByRole("button", { name: /post comment/i }));

    expect(
      await screen.findByText("Following up with the vendor."),
    ).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit?]) =>
        url === COMMENTS_URL && init?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const [, init] = postCall as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });
});

describe("Internal Notes thread (variant=internal)", () => {
  it('renders the "Internal notes" heading with its private badge and a posted note body; posting calls POST and appends the new note', async () => {
    const fetchMock = mockFetch({
      notes: [
        {
          id: 1,
          body: "Escalated to networking vendor.",
          createdAt: "2026-09-01T09:20:00.000Z",
          author: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
        },
      ],
      postNote: (init) => {
        const { body } = JSON.parse((init?.body as string) ?? "{}");
        return jsonResponse(201, {
          id: 2,
          body,
          createdAt: "2026-09-02T10:05:00.000Z",
          author: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
        });
      },
    });
    renderScreen();

    await screen.findByText("TKT-2026-000021");
    const heading = await screen.findByRole("heading", {
      name: "Internal notes",
    });
    expect(heading).toBeInTheDocument();
    expect(
      screen.getByText("Private — not visible to the Requester"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Escalated to networking vendor."),
    ).toBeInTheDocument();

    // MessageThread prefixes each internal entry with a 🔒 glyph
    // (MessageThread.tsx's VARIANT_CONFIG.internal.entryPrefix).
    const thread = heading.closest(".zen-message-thread") as HTMLElement;
    expect(within(thread).getByText("🔒")).toBeInTheDocument();

    const textarea = screen.getByLabelText(/add an internal note/i);
    fireEvent.change(textarea, {
      target: { value: "Vendor confirmed a firmware fix is available." },
    });
    fireEvent.click(screen.getByRole("button", { name: /save internal note/i }));

    expect(
      await screen.findByText("Vendor confirmed a firmware fix is available."),
    ).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit?]) =>
        url === NOTES_URL && init?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const [, init] = postCall as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });
});

describe("Administrator read access (ui-spec.md §10, api-spec.md §5)", () => {
  it("an ADMINISTRATOR can also load the read-only view and see both threads", async () => {
    mockFetch({
      comments: [
        {
          id: 1,
          body: "Public comment visible to the requester.",
          createdAt: "2026-09-01T09:00:00.000Z",
          author: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
        },
      ],
      notes: [
        {
          id: 2,
          body: "Internal-only note.",
          createdAt: "2026-09-01T09:05:00.000Z",
          author: { id: 9, name: "Jordan Lee", role: "IT_STAFF" },
        },
      ],
    });
    const { container } = renderScreen({ user: ADMIN_USER });

    await screen.findByText("TKT-2026-000021");
    const detail = within(infoCard(container));
    expect(detail.getByText("Jennifer Anderson")).toBeInTheDocument();

    expect(
      await screen.findByRole("heading", { name: "Comments" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Public comment visible to the requester."),
    ).toBeInTheDocument();

    expect(
      await screen.findByRole("heading", { name: "Internal notes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Internal-only note.")).toBeInTheDocument();
  });
});
