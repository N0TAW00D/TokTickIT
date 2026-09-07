import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  AttachmentUploader,
  type QueuedAttachment,
} from "../../src/components/AttachmentUploader.tsx";
import { AttachmentList } from "../../src/components/AttachmentList.tsx";
import { AttachmentSection } from "../../src/components/AttachmentSection.tsx";
import { CreateTicketScreen } from "../../src/screens/CreateTicketScreen.tsx";
import {
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";
import {
  AttachmentRemovedError,
  downloadAttachment,
  filenameFromContentDisposition,
  removeAttachment,
  RemoveAttachmentError,
  uploadAttachment,
  UploadAttachmentError,
  type TicketAttachment,
} from "../../src/tickets/api.ts";

// Covers docs/lab-02/tests.md rows C-15 (attachment client validation),
// C-16 (partial attachment failure after a successful create), C-17
// (add-attachment disabled at the 5-attachment ceiling), C-18 (remove
// dialog happy path), C-19 (remove dialog reason required), C-20 (removed
// attachment presentation), and C-21 (attachment actions per type).

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

function makeFile(name: string, sizeBytes: number, type: string): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

/** Minimal controlled harness so tests can drive AttachmentUploader like a real caller (CreateTicketScreen) would. */
function Harness({
  activeCount = 0,
  disabled = false,
  initialQueued = [],
}: {
  activeCount?: number;
  disabled?: boolean;
  initialQueued?: QueuedAttachment[];
}) {
  const [queued, setQueued] = useState<QueuedAttachment[]>(initialQueued);
  return (
    <AttachmentUploader
      idPrefix="harness"
      queued={queued}
      onQueuedChange={setQueued}
      activeCount={activeCount}
      disabled={disabled}
    />
  );
}

function getFileInput(): HTMLInputElement {
  return screen.getByLabelText(/attachment files/i) as HTMLInputElement;
}

afterEach(() => {
  cleanup();
});

describe("C-15 attachment client validation", () => {
  it("queues a valid PDF with its name and size, rejects a .exe with a per-file message, and does not queue it (AC-18)", () => {
    render(<Harness />);

    const pdf = makeFile("battery-report.pdf", 243 * 1024, "application/pdf");
    const exe = makeFile("virus.exe", 1024, "application/x-msdownload");

    fireEvent.change(getFileInput(), { target: { files: [pdf, exe] } });

    // Valid file: queued, name + size shown, with a Remove control.
    expect(screen.getByText("battery-report.pdf")).toBeInTheDocument();
    expect(screen.getByText("243 KB")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove/i }),
    ).toBeInTheDocument();

    // Invalid file: rejected with a per-file message, no Remove control for it.
    expect(screen.getByText("virus.exe")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Unsupported file type");
    // Only one file made it into the queue — the exe never got a Remove button.
    expect(screen.getAllByRole("button", { name: /remove/i })).toHaveLength(1);
  });

  it("rejects a 6 MB image with a size message and does not queue it (AC-19)", () => {
    render(<Harness />);

    const tooBig = makeFile("photo.png", 6 * 1024 * 1024, "image/png");
    fireEvent.change(getFileInput(), { target: { files: [tooBig] } });

    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "larger than 5 MB",
    );
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it("accepts a file of exactly 5 MB (BR-22 boundary)", () => {
    render(<Harness />);

    const exact = makeFile("scan.pdf", MAX_SIZE_BYTES, "application/pdf");
    fireEvent.change(getFileInput(), { target: { files: [exact] } });

    expect(screen.getByText("scan.pdf")).toBeInTheDocument();
    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove/i }),
    ).toBeInTheDocument();
  });

  it("rejects a file of 5 MB + 1 byte (BR-22 boundary)", () => {
    render(<Harness />);

    const overBy1 = makeFile(
      "scan-too-big.pdf",
      MAX_SIZE_BYTES + 1,
      "application/pdf",
    );
    fireEvent.change(getFileInput(), { target: { files: [overBy1] } });

    expect(screen.getByText("scan-too-big.pdf")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("larger than 5 MB");
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["a .txt file", "notes.txt", "text/plain"],
    ["a .gif image", "animation.gif", "image/gif"],
    ["a file with no detected type", "unknown", ""],
  ])("rejects %s as an unsupported type", (_label, name, type) => {
    render(<Harness />);

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile(name, 1024, type)] },
    });

    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unsupported file type",
    );
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it("accepts every allowed type — JPEG, PNG, WEBP, PDF", () => {
    render(<Harness />);

    const files = [
      makeFile("photo.jpg", 1024, "image/jpeg"),
      makeFile("photo.png", 1024, "image/png"),
      makeFile("photo.webp", 1024, "image/webp"),
      makeFile("doc.pdf", 1024, "application/pdf"),
    ];
    fireEvent.change(getFileInput(), { target: { files } });

    for (const file of files) {
      expect(screen.getByText(file.name)).toBeInTheDocument();
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /remove/i })).toHaveLength(
      files.length,
    );
  });

  it("rejects a .exe carrying an allowed MIME type — extension is checked independently of MIME (ui-spec.md §8)", () => {
    render(<Harness />);

    // The MIME type alone is one of the allowed four; only the extension
    // makes this file invalid. The `accept` attribute is a picker hint
    // only, so this must be caught by validateFile itself.
    const disguised = makeFile("virus.exe", 1024, "image/png");
    fireEvent.change(getFileInput(), { target: { files: [disguised] } });

    expect(screen.getByText("virus.exe")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unsupported file type",
    );
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it("rejects an allowed extension carrying a disallowed MIME type — MIME is checked independently of extension (ui-spec.md §8)", () => {
    render(<Harness />);

    // Mirror of the .exe-with-allowed-MIME case above: here the
    // extension alone is one of the allowed five; only the MIME type
    // makes this file invalid. A file's declared MIME type isn't
    // trustworthy either, so validateFile must reject this even though
    // the extension gate alone would let it through — this is the one
    // case that can only be caught by the ALLOWED_MIME_TYPES check.
    const disguised = makeFile("photo.png", 1024, "application/x-msdownload");
    fireEvent.change(getFileInput(), { target: { files: [disguised] } });

    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unsupported file type",
    );
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it("accepts an uppercase extension — the extension check is case-insensitive", () => {
    render(<Harness />);

    const shouting = makeFile("PHOTO.PNG", 1024, "image/png");
    fireEvent.change(getFileInput(), { target: { files: [shouting] } });

    expect(screen.getByText("PHOTO.PNG")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove/i }),
    ).toBeInTheDocument();
  });

  it("rejects a file with no extension at all, even with an allowed MIME type", () => {
    render(<Harness />);

    const noExt = makeFile("unknown", 1024, "application/pdf");
    fireEvent.change(getFileInput(), { target: { files: [noExt] } });

    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unsupported file type",
    );
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it("accepts a multi-dot filename using its last segment as the extension", () => {
    render(<Harness />);

    const multiDot = makeFile("report.final.pdf", 1024, "application/pdf");
    fireEvent.change(getFileInput(), { target: { files: [multiDot] } });

    expect(screen.getByText("report.final.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove/i }),
    ).toBeInTheDocument();
  });

  it("removes a queued file when its Remove button is clicked", () => {
    render(<Harness />);

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("doc.pdf", 1024, "application/pdf")] },
    });
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(screen.queryByText("doc.pdf")).not.toBeInTheDocument();
  });
});

describe("C-17 add-attachment disabled at 5", () => {
  it("is enabled with no tooltip below the limit (4 active)", () => {
    render(<Harness activeCount={4} />);

    const addButton = screen.getByRole("button", { name: /add files/i });
    expect(addButton).toBeEnabled();
    expect(addButton).not.toHaveAttribute("title");
  });

  it("disables Add with the required tooltip once 5 active attachments exist (AC-20, BR-23)", () => {
    render(<Harness activeCount={5} />);

    const addButton = screen.getByRole("button", { name: /add files/i });
    expect(addButton).toBeDisabled();
    expect(addButton).toHaveAttribute(
      "title",
      "Maximum of 5 active attachments",
    );
  });

  it("also disables Add once active + queued together reach 5 (BR-23 applies to the ticket's total, not just what's already active)", () => {
    render(<Harness activeCount={3} initialQueued={[
      { id: "a", file: makeFile("one.pdf", 1024, "application/pdf") },
      { id: "b", file: makeFile("two.pdf", 1024, "application/pdf") },
    ]} />);

    const addButton = screen.getByRole("button", { name: /add files/i });
    expect(addButton).toBeDisabled();
    expect(addButton).toHaveAttribute(
      "title",
      "Maximum of 5 active attachments",
    );
  });
});

// --- C-16: integration through CreateTicketScreen (create → sequential uploads). ---

const API_BASE_URL = "http://localhost:3000";
const CATEGORIES_URL = `${API_BASE_URL}/api/categories`;
const RELATED_SYSTEMS_URL = `${API_BASE_URL}/api/related-systems`;
const TICKETS_URL = `${API_BASE_URL}/api/tickets`;

const CATEGORIES = [{ id: 1, name: "Hardware" }];
const RELATED_SYSTEMS = [{ id: 10, name: "Email" }];

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

const ATTACHMENTS_URL = `${TICKETS_URL}/${SUCCESS_TICKET.id}/attachments`;

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function uploadedFileName(init: RequestInit | undefined): string | undefined {
  const body = init?.body;
  if (!(body instanceof FormData)) return undefined;
  const file = body.get("file");
  return file instanceof File ? file.name : undefined;
}

/**
 * `attachmentResult` maps an uploaded file's name to the response it
 * should get, so a test can make one queued file succeed and another fail
 * within the same batch (BR-27: uploads are independent, sequential
 * requests — one failing must not abort the rest).
 */
function mockFetch(attachmentResult: (fileName: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === CATEGORIES_URL) return jsonResponse(200, CATEGORIES);
    if (input === RELATED_SYSTEMS_URL)
      return jsonResponse(200, RELATED_SYSTEMS);
    if (input === TICKETS_URL && init?.method === "POST") {
      return jsonResponse(201, SUCCESS_TICKET);
    }
    if (input === ATTACHMENTS_URL && init?.method === "POST") {
      const fileName = uploadedFileName(init);
      return attachmentResult(fileName ?? "");
    }
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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

async function fillValidFormAndQueue(files: File[]) {
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

  fireEvent.change(screen.getByLabelText(/attachment files/i), {
    target: { files },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("C-16 partial attachment failure (AC-21, BR-27)", () => {
  it("shows the success panel naming the one failed attachment, while the ticket itself reports success", async () => {
    const fetchMock = mockFetch((fileName) =>
      fileName === "screenshot.png"
        ? jsonResponse(500, { error: "INTERNAL", message: "Disk error." })
        : jsonResponse(201, {
            id: 7,
            ticketId: SUCCESS_TICKET.id,
            originalFilename: fileName,
            mimeType: "image/png",
            fileSize: 1024,
            isRemoved: false,
            removedAt: null,
            removedReason: null,
            createdAt: "2026-09-01T08:15:10.000Z",
          }),
    );

    renderScreen();
    await fillValidFormAndQueue([
      makeFile("screenshot.png", 1024, "image/png"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const panel = await screen.findByRole("status");
    // The ticket exists and is reported as such — a failed attachment must
    // never look like a failed ticket.
    expect(panel).toHaveTextContent(SUCCESS_TICKET.ticketNumber);
    expect(
      screen.queryByText(
        "Could not create the ticket. Please check your connection and try again.",
      ),
    ).not.toBeInTheDocument();

    const warning = await screen.findByRole("note");
    // Exact copy from ui-spec.md §8 ("Success with a failed attachment"):
    // "1 attachment could not be uploaded: screenshot.png. You can retry
    // it from the ticket." — a substring match would also pass against
    // near-miss wording, so assert the full literal.
    expect(warning).toHaveTextContent(
      "1 attachment could not be uploaded: screenshot.png. You can retry it from the ticket.",
    );

    expect(
      fetchMock.mock.calls.filter(
        ([url, init]: [string, RequestInit?]) =>
          url === ATTACHMENTS_URL && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("uploads every queued file independently — one failing does not stop the others, and only the failure is named", async () => {
    const fetchMock = mockFetch((fileName) =>
      fileName === "bad.png"
        ? jsonResponse(415, {
            error: "UNSUPPORTED_TYPE",
            message: "Type not allowed.",
          })
        : jsonResponse(201, {
            id: 8,
            ticketId: SUCCESS_TICKET.id,
            originalFilename: fileName,
            mimeType: "application/pdf",
            fileSize: 1024,
            isRemoved: false,
            removedAt: null,
            removedReason: null,
            createdAt: "2026-09-01T08:15:10.000Z",
          }),
    );

    renderScreen();
    // "bad.png" is given an allowed client-side type (image/png) so it
    // passes client validation and actually reaches the server, which is
    // what rejects it here — this exercises the server-failure path, not
    // client validation (already covered by C-15). It's queued FIRST and
    // "good.pdf" SECOND deliberately: if uploads stopped at the first
    // failure instead of continuing independently (BR-27), "good.pdf"
    // would never even be attempted, and this test must catch that.
    await fillValidFormAndQueue([
      makeFile("bad.png", 1024, "image/png"),
      makeFile("good.pdf", 1024, "application/pdf"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const warning = await screen.findByRole("note");
    // Same exact ui-spec.md §8 wording as above, singular — only one of
    // the two queued files failed, so "good.pdf" must not appear.
    expect(warning).toHaveTextContent(
      "1 attachment could not be uploaded: bad.png. You can retry it from the ticket.",
    );

    const attachmentCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit?]) =>
        url === ATTACHMENTS_URL && init?.method === "POST",
    );
    expect(attachmentCalls).toHaveLength(2);
  });

  it("names every failed attachment, plural, when more than one upload fails", async () => {
    const fetchMock = mockFetch((fileName) =>
      fileName === "good.pdf"
        ? jsonResponse(201, {
            id: 9,
            ticketId: SUCCESS_TICKET.id,
            originalFilename: fileName,
            mimeType: "application/pdf",
            fileSize: 1024,
            isRemoved: false,
            removedAt: null,
            removedReason: null,
            createdAt: "2026-09-01T08:15:10.000Z",
          })
        : jsonResponse(500, { error: "INTERNAL", message: "Disk error." }),
    );

    renderScreen();
    await fillValidFormAndQueue([
      makeFile("bad-one.png", 1024, "image/png"),
      makeFile("good.pdf", 1024, "application/pdf"),
      makeFile("bad-two.png", 1024, "image/png"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const warning = await screen.findByRole("note");
    // ui-spec.md §8 gives the exact singular wording only; it does not
    // spell out the plural sentence verbatim anywhere in the frozen
    // docs. This literal is the singular pattern's natural pluralization
    // ("attachment"→"attachments", "it"→"them") and is hardcoded here
    // rather than derived by calling describeFailedAttachments — if that
    // is ever worth freezing exactly, it belongs in ui-spec.md.
    expect(warning).toHaveTextContent(
      "2 attachments could not be uploaded: bad-one.png, bad-two.png. You can retry them from the ticket.",
    );

    const attachmentCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit?]) =>
        url === ATTACHMENTS_URL && init?.method === "POST",
    );
    expect(attachmentCalls).toHaveLength(3);
  });

  it("shows no warning callout when every queued attachment uploads successfully", async () => {
    mockFetch(() =>
      jsonResponse(201, {
        id: 9,
        ticketId: SUCCESS_TICKET.id,
        originalFilename: "ok.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        isRemoved: false,
        removedAt: null,
        removedReason: null,
        createdAt: "2026-09-01T08:15:10.000Z",
      }),
    );

    renderScreen();
    await fillValidFormAndQueue([makeFile("ok.pdf", 1024, "application/pdf")]);

    fireEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    const panel = await screen.findByRole("status");
    expect(panel).toHaveTextContent(SUCCESS_TICKET.ticketNumber);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// Not a tests.md row on its own, but explicitly required by the task: the
// server's three distinct attachment-upload failure codes (api-spec.md
// §4.1) must be distinguishable by the caller, not collapsed into one
// generic Error — otherwise CreateTicketScreen (and any future caller)
// couldn't tell "wrong type" from "too big" from "at the limit" without
// re-parsing the response body itself.
describe("uploadAttachment distinguishes 415/413/409 (api-spec.md §4.1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("raises UploadAttachmentError with code UNSUPPORTED_TYPE on 415", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(415, {
          error: "UNSUPPORTED_TYPE",
          message: "Type not allowed.",
        }),
      ),
    );

    const promise = uploadAttachment(
      1,
      42,
      makeFile("virus.exe", 10, "application/x-msdownload"),
    );
    await expect(promise).rejects.toBeInstanceOf(UploadAttachmentError);
    await expect(promise).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
  });

  it("raises UploadAttachmentError with code FILE_TOO_LARGE on 413", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(413, {
          error: "FILE_TOO_LARGE",
          message: "File exceeds 5 MB.",
        }),
      ),
    );

    const promise = uploadAttachment(
      1,
      42,
      makeFile("big.pdf", 10, "application/pdf"),
    );
    await expect(promise).rejects.toBeInstanceOf(UploadAttachmentError);
    await expect(promise).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("raises UploadAttachmentError with code ATTACHMENT_LIMIT on 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(409, {
          error: "ATTACHMENT_LIMIT",
          message: "Ticket already has 5 active attachments.",
        }),
      ),
    );

    const promise = uploadAttachment(
      1,
      42,
      makeFile("one-more.pdf", 10, "application/pdf"),
    );
    await expect(promise).rejects.toBeInstanceOf(UploadAttachmentError);
    await expect(promise).rejects.toMatchObject({ code: "ATTACHMENT_LIMIT" });
  });

  it("the three codes are pairwise distinct — no two of 415/413/409 collapse to the same code", async () => {
    const codes = new Set<string>();
    for (const status of [415, 413, 409] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => jsonResponse(status, { error: "X", message: "m" })),
      );
      try {
        await uploadAttachment(1, 42, makeFile("f.pdf", 10, "application/pdf"));
      } catch (error) {
        if (error instanceof UploadAttachmentError) codes.add(error.code);
      }
    }
    expect(codes.size).toBe(3);
  });

  it("raises a plain Error, not UploadAttachmentError, on a 404 (ticket not owned/unknown)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(404, { error: "NOT_FOUND", message: "Not found." }),
      ),
    );

    const promise = uploadAttachment(
      1,
      42,
      makeFile("f.pdf", 10, "application/pdf"),
    );
    await expect(promise).rejects.not.toBeInstanceOf(UploadAttachmentError);
    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  it("raises a plain Error, not UploadAttachmentError, on a 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(500, { error: "INTERNAL", message: "Broke." }),
      ),
    );

    const promise = uploadAttachment(
      1,
      42,
      makeFile("f.pdf", 10, "application/pdf"),
    );
    await expect(promise).rejects.not.toBeInstanceOf(UploadAttachmentError);
    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  it("sends the file as multipart/form-data with the X-Requester-Id header (api-spec.md §1.2, §4.1)", async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse(201, {
        id: 1,
        ticketId: 42,
        originalFilename: "f.pdf",
        mimeType: "application/pdf",
        fileSize: 10,
        isRemoved: false,
        removedAt: null,
        removedReason: null,
        createdAt: "2026-09-01T08:15:10.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadAttachment(7, 42, makeFile("f.pdf", 10, "application/pdf"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/tickets/42/attachments");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-Requester-Id": "7" });
    // Content-Type must be left for the browser to set from the FormData
    // body — a manually-set "multipart/form-data" header would omit the
    // boundary and break server-side parsing.
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeInstanceOf(FormData);
    const uploaded = (init.body as FormData).get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe("f.pdf");
  });
});

// --- C-20 / C-21: AttachmentList row rendering on Ticket Detail. ---
//
// AttachmentList is a pure presentational component (like
// AttachmentUploader above) — these tests render it directly with fixed
// attachment fixtures rather than going through TicketDetailScreen's
// fetch, since the row-presentation rules (ui-spec.md §10 row table,
// BR-33, BR-34) are independent of how the data got there.

/** Active PDF (api-spec.md §3.3 example): Download + Remove, no Preview. */
const ACTIVE_PDF: TicketAttachment = {
  id: 1,
  originalFilename: "battery-report.pdf",
  mimeType: "application/pdf",
  fileSize: 249184, // -> "243 KB"
  isRemoved: false,
  removedAt: null,
  removedReason: null,
  createdAt: "2026-09-01T08:15:10.000Z",
};

/** Active image: Preview + Download + Remove. */
const ACTIVE_IMAGE: TicketAttachment = {
  id: 2,
  originalFilename: "photo.png",
  mimeType: "image/png",
  fileSize: 819200, // 800 * 1024 -> "800 KB"
  isRemoved: false,
  removedAt: null,
  removedReason: null,
  createdAt: "2026-09-01T08:16:00.000Z",
};

/**
 * Removed attachment: metadata only, no controls. `removedAt` is UTC
 * "2026-09-01T02:02:00.000Z", which is 09:02 in Asia/Bangkok (UTC+7,
 * specification.md BR-04/A-11) — the expected string below is hardcoded
 * independently of formatDateTime, not derived by calling it (lesson: a
 * test must not validate a function by calling that same function).
 */
const REMOVED_ATTACHMENT: TicketAttachment = {
  id: 3,
  originalFilename: "screenshot.png",
  mimeType: "image/png",
  fileSize: 512000, // 500 * 1024 -> "500 KB"
  isRemoved: true,
  removedAt: "2026-09-01T02:02:00.000Z",
  removedReason: "Wrong screenshot",
  createdAt: "2026-09-01T08:17:00.000Z",
};

describe("C-21 attachment actions (AC-33, BR-34)", () => {
  it("active image: Preview + Download + Remove all present", () => {
    render(<AttachmentList attachments={[ACTIVE_IMAGE]} />);

    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("800 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("active PDF: Download + Remove present, Preview absent", () => {
    render(<AttachmentList attachments={[ACTIVE_PDF]} />);

    expect(screen.getByText("battery-report.pdf")).toBeInTheDocument();
    expect(screen.getByText("243 KB")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /preview/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });
});

describe("C-20 removed attachment presentation (AC-36, BR-33)", () => {
  it("shows name, size, type, and \"Removed <date> · \\\"<reason>\\\"\", with no Download/Preview/Remove control", () => {
    render(<AttachmentList attachments={[REMOVED_ATTACHMENT]} />);

    // Metadata: name, size, type.
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    expect(screen.getByText("500 KB")).toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();

    // Removed date + reason, exact literal shape from ui-spec.md §10.
    expect(
      screen.getByText('Removed 1 Sep, 09:02 · "Wrong screenshot"'),
    ).toBeInTheDocument();

    // No download link, no inline preview, no remove control (BR-33).
    expect(
      screen.queryByRole("button", { name: /download/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /preview/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

// --- C-18 / C-19: the Remove confirmation dialog, wired end-to-end via
// AttachmentSection (AttachmentList's Remove button -> RemoveAttachmentDialog
// -> removeAttachment -> DELETE /api/attachments/:id). ---

/** A removable active attachment (api-spec.md §3.3 example). */
const REMOVABLE_ATTACHMENT: TicketAttachment = {
  id: 1,
  originalFilename: "battery-report.pdf",
  mimeType: "application/pdf",
  fileSize: 249184,
  isRemoved: false,
  removedAt: null,
  removedReason: null,
  createdAt: "2026-09-01T08:15:10.000Z",
};

const ATTACHMENT_DELETE_URL = `${API_BASE_URL}/api/attachments/1`;

/**
 * Minimal controlled harness: owns the attachments array the way
 * TicketDetailScreen does, so a successful removal (reported via
 * onAttachmentRemoved) is visibly reflected back into AttachmentList,
 * exactly like the real screen's state splice.
 */
function AttachmentSectionHarness({
  initialAttachments,
  requesterId = 7,
  ticketId = 1,
  withUpload = false,
}: {
  initialAttachments: TicketAttachment[];
  requesterId?: number;
  ticketId?: number;
  /** When true, wire `onAttachmentAdded` so the Add-attachment control renders. */
  withUpload?: boolean;
}) {
  const [attachments, setAttachments] = useState(initialAttachments);
  return (
    <AttachmentSection
      attachments={attachments}
      requesterId={requesterId}
      ticketId={ticketId}
      onAttachmentRemoved={(updated) =>
        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.id === updated.id ? updated : attachment,
          ),
        )
      }
      onAttachmentAdded={
        withUpload
          ? (added) => setAttachments((previous) => [...previous, added])
          : undefined
      }
    />
  );
}

function deleteCallsOf(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([, init]: [string, RequestInit?]) => init?.method === "DELETE",
  );
}

describe("C-18 remove dialog happy path (AC-34)", () => {
  it('Remove opens a dialog naming the file with a required Reason field; submitting a valid reason moves the row to "Removed" and shows a role="status" toast', async () => {
    // removedAt UTC 2026-09-02T03:15:00.000Z is 10:15 in Asia/Bangkok
    // (UTC+7, specification.md BR-04/A-11) -> "2 Sep, 10:15", hardcoded
    // independently of formatDateTime, same as C-20's fixture above.
    const updatedAttachment: TicketAttachment = {
      ...REMOVABLE_ATTACHMENT,
      isRemoved: true,
      removedAt: "2026-09-02T03:15:00.000Z",
      removedReason: "Uploaded the wrong file",
    };
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === ATTACHMENT_DELETE_URL && init?.method === "DELETE") {
        return jsonResponse(200, updatedAttachment);
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    // Dialog: title "Remove attachment", body names the file, required
    // Reason for removal field (ui-spec.md §10).
    const dialog = screen.getByRole("dialog", { name: /remove attachment/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText(/battery-report\.pdf/)).toBeInTheDocument();
    const reasonField = screen.getByLabelText(/reason for removal/i);
    expect(reasonField).toHaveAttribute("aria-required", "true");

    fireEvent.change(reasonField, {
      target: { value: "Uploaded the wrong file" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove attachment$/i }),
    );

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent('"battery-report.pdf" was removed.');

    // Dialog closed.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Row now shows the Removed presentation (exact literal shape, C-20).
    expect(
      screen.getByText('Removed 2 Sep, 10:15 · "Uploaded the wrong file"'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^remove$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /download/i }),
    ).not.toBeInTheDocument();

    // Exactly one DELETE, with the right headers and JSON body
    // (api-spec.md §4.4: X-Requester-Id, Content-Type: application/json,
    // { reason }).
    const deleteCalls = deleteCallsOf(fetchMock);
    expect(deleteCalls).toHaveLength(1);
    const [url, init] = deleteCalls[0] as [string, RequestInit];
    expect(url).toBe(ATTACHMENT_DELETE_URL);
    expect(init.headers).toMatchObject({
      "X-Requester-Id": "7",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      reason: "Uploaded the wrong file",
    });
  });

  it("accepts a reason of exactly 3 characters (BR-31/A-09 lower boundary)", async () => {
    const updated: TicketAttachment = {
      ...REMOVABLE_ATTACHMENT,
      isRemoved: true,
      removedAt: "2026-09-02T03:15:00.000Z",
      removedReason: "abc",
    };
    const fetchMock = vi.fn((input: string, init?: RequestInit) =>
      input === ATTACHMENT_DELETE_URL && init?.method === "DELETE"
        ? jsonResponse(200, updated)
        : jsonResponse(404, {}),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    fireEvent.change(screen.getByLabelText(/reason for removal/i), {
      target: { value: "abc" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove attachment$/i }),
    );

    await screen.findByRole("status");
    expect(deleteCallsOf(fetchMock)).toHaveLength(1);
  });

  it("accepts a reason of exactly 200 characters (BR-31/A-09 upper boundary)", async () => {
    const longReason = "x".repeat(200);
    const updated: TicketAttachment = {
      ...REMOVABLE_ATTACHMENT,
      isRemoved: true,
      removedAt: "2026-09-02T03:15:00.000Z",
      removedReason: longReason,
    };
    const fetchMock = vi.fn((input: string, init?: RequestInit) =>
      input === ATTACHMENT_DELETE_URL && init?.method === "DELETE"
        ? jsonResponse(200, updated)
        : jsonResponse(404, {}),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    fireEvent.change(screen.getByLabelText(/reason for removal/i), {
      target: { value: longReason },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove attachment$/i }),
    );

    await screen.findByRole("status");
    const deleteCalls = deleteCallsOf(fetchMock);
    expect(deleteCalls).toHaveLength(1);
    expect(
      JSON.parse((deleteCalls[0] as [string, RequestInit])[1].body as string),
    ).toEqual({ reason: longReason });
  });
});

describe("C-19 remove dialog reason required (AC-35)", () => {
  it.each([
    ["an empty reason", ""],
    ["a 2-character reason", "no"],
    ["a 201-character reason (one past the upper bound)", "x".repeat(201)],
    ["a whitespace-only reason (rule is on the trimmed length)", "   "],
  ])(
    "shows the field error and keeps the dialog open for %s, firing no DELETE",
    (_label, reasonValue) => {
      const fetchMock = vi.fn(() => jsonResponse(200, REMOVABLE_ATTACHMENT));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <AttachmentSectionHarness
          initialAttachments={[REMOVABLE_ATTACHMENT]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
      if (reasonValue) {
        fireEvent.change(screen.getByLabelText(/reason for removal/i), {
          target: { value: reasonValue },
        });
      }
      fireEvent.click(
        screen.getByRole("button", { name: /^remove attachment$/i }),
      );

      expect(
        screen.getByText(
          "Reason for removal must be between 3 and 200 characters.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(deleteCallsOf(fetchMock)).toHaveLength(0);
    },
  );

  it("clears the field error and fires the DELETE once the reason is corrected", async () => {
    const updated: TicketAttachment = {
      ...REMOVABLE_ATTACHMENT,
      isRemoved: true,
      removedAt: "2026-09-02T03:15:00.000Z",
      removedReason: "Now a valid reason",
    };
    const fetchMock = vi.fn((input: string, init?: RequestInit) =>
      input === ATTACHMENT_DELETE_URL && init?.method === "DELETE"
        ? jsonResponse(200, updated)
        : jsonResponse(404, {}),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    const reasonField = screen.getByLabelText(/reason for removal/i);
    fireEvent.change(reasonField, { target: { value: "no" } });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove attachment$/i }),
    );
    expect(
      screen.getByText(
        "Reason for removal must be between 3 and 200 characters.",
      ),
    ).toBeInTheDocument();
    expect(deleteCallsOf(fetchMock)).toHaveLength(0);

    fireEvent.change(reasonField, { target: { value: "Now a valid reason" } });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove attachment$/i }),
    );

    await screen.findByRole("status");
    expect(deleteCallsOf(fetchMock)).toHaveLength(1);
  });
});

// Not a tests.md row on its own, but explicitly required by ui-spec.md §10
// ("focus trapped in the dialog", "Esc cancels, returns focus to the
// triggering Remove button").
describe("Remove dialog keyboard behavior (ui-spec.md §10)", () => {
  it("focuses the Reason field when the dialog opens", () => {
    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(screen.getByLabelText(/reason for removal/i)).toHaveFocus();
  });

  it("Esc cancels the dialog without firing DELETE, and returns focus to the triggering Remove button", () => {
    const fetchMock = vi.fn(() => jsonResponse(200, REMOVABLE_ATTACHMENT));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    const removeButton = screen.getByRole("button", { name: /^remove$/i });
    fireEvent.click(removeButton);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(removeButton).toHaveFocus();
    expect(deleteCallsOf(fetchMock)).toHaveLength(0);
  });

  it("Cancel closes the dialog and returns focus to the triggering Remove button", () => {
    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    const removeButton = screen.getByRole("button", { name: /^remove$/i });
    fireEvent.click(removeButton);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(removeButton).toHaveFocus();
  });

  it("Tab from the last focusable element wraps to the first (focus trap)", () => {
    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    const submitButton = screen.getByRole("button", {
      name: /^remove attachment$/i,
    });
    submitButton.focus();
    fireEvent.keyDown(submitButton, { key: "Tab" });

    expect(screen.getByLabelText(/reason for removal/i)).toHaveFocus();
  });

  it("Shift+Tab from the first focusable element wraps to the last (focus trap)", () => {
    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    const reasonField = screen.getByLabelText(/reason for removal/i);
    reasonField.focus();
    fireEvent.keyDown(reasonField, { key: "Tab", shiftKey: true });

    expect(
      screen.getByRole("button", { name: /^remove attachment$/i }),
    ).toHaveFocus();
  });
});

// Not a tests.md row on its own, but explicitly required by the task: a
// 409 ALREADY_REMOVED must be distinguishable from a 400 field error
// (api-spec.md §4.4) — a conflict banner, not the reason field's error —
// and must keep the dialog open without applying any local removal.
describe("AttachmentSection distinguishes 409 ALREADY_REMOVED from a field error", () => {
  it("shows a conflict alert (not the field error) and keeps the dialog + active row on a 409", async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse(409, {
        error: "ALREADY_REMOVED",
        message: "This attachment is already removed.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    const reasonField = screen.getByLabelText(/reason for removal/i);
    fireEvent.change(reasonField, {
      target: { value: "Valid reason" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove attachment$/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This attachment is already removed.");

    // The message renders in the dedicated conflict slot, not the field's
    // own error slot — a 409 must not masquerade as a bad-reason field
    // error even though both currently use role="alert".
    expect(alert).toHaveClass("zen-remove-dialog__conflict");
    expect(
      container.querySelector("#remove-attachment-reason-error"),
    ).not.toBeInTheDocument();
    expect(reasonField).not.toHaveAttribute("aria-invalid", "true");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Reason for removal must be between 3 and 200 characters.",
      ),
    ).not.toBeInTheDocument();

    // No removal was applied locally — the row is still active.
    expect(screen.getByRole("button", { name: /^remove$/i })).toBeInTheDocument();
  });
});

// AC-35 also names the server's own `400 VALIDATION_FAILED` (api-spec.md
// §4.4), reached when a reason that clears the client-side check is still
// rejected server-side (the two rules are expected to agree, so this is
// defence in depth). It must surface on the Reason field itself — not the
// 409 conflict slot — and keep the dialog open.
describe("AttachmentSection surfaces a server 400 VALIDATION_FAILED on the Reason field (AC-35)", () => {
  it("shows the server field message on the Reason field, keeps the dialog open, and applies no local removal", async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse(400, {
        error: "VALIDATION_FAILED",
        message: "One or more fields are invalid.",
        fields: [
          {
            field: "reason",
            message: "reason must be between 3 and 200 characters after trimming.",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    const reasonField = screen.getByLabelText(/reason for removal/i);
    // Passes the client-side 3-200 check, so the request is actually sent
    // and the server's 400 is what surfaces.
    fireEvent.change(reasonField, { target: { value: "Valid reason" } });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove attachment$/i }),
    );

    const fieldError = await screen.findByText(
      "reason must be between 3 and 200 characters after trimming.",
    );
    expect(fieldError).toHaveAttribute("id", "remove-attachment-reason-error");
    expect(reasonField).toHaveAttribute("aria-invalid", "true");

    // Not the 409 conflict slot.
    expect(
      container.querySelector(".zen-remove-dialog__conflict"),
    ).not.toBeInTheDocument();

    // Dialog open, one DELETE attempt, row still active.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteCallsOf(fetchMock)).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /^remove$/i }),
    ).toBeInTheDocument();
  });
});

// Mirrors the "uploadAttachment distinguishes 415/413/409" block above:
// removeAttachment's two server rules (api-spec.md §4.4) must be
// distinguishable by the caller, and every other failure must not be
// mistaken for one of them.
describe("removeAttachment distinguishes 400/409 (api-spec.md §4.4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("raises RemoveAttachmentError with code VALIDATION_FAILED on 400, carrying fields[]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(400, {
          error: "VALIDATION_FAILED",
          message: "One or more fields are invalid.",
          fields: [
            {
              field: "reason",
              message:
                "reason must be between 3 and 200 characters after trimming.",
            },
          ],
        }),
      ),
    );

    const promise = removeAttachment(1, 5, "ok reason");
    await expect(promise).rejects.toBeInstanceOf(RemoveAttachmentError);
    await expect(promise).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fields: [
        {
          field: "reason",
          message:
            "reason must be between 3 and 200 characters after trimming.",
        },
      ],
    });
  });

  it("raises RemoveAttachmentError with code ALREADY_REMOVED on 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(409, {
          error: "ALREADY_REMOVED",
          message: "This attachment is already removed.",
        }),
      ),
    );

    const promise = removeAttachment(1, 5, "ok reason");
    await expect(promise).rejects.toBeInstanceOf(RemoveAttachmentError);
    await expect(promise).rejects.toMatchObject({ code: "ALREADY_REMOVED" });
  });

  it("the two codes are pairwise distinct — 400 and 409 do not collapse to the same code", async () => {
    const codes = new Set<string>();
    for (const status of [400, 409] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => jsonResponse(status, { error: "X", message: "m" })),
      );
      try {
        await removeAttachment(1, 5, "ok reason");
      } catch (error) {
        if (error instanceof RemoveAttachmentError) codes.add(error.code);
      }
    }
    expect(codes.size).toBe(2);
  });

  it("raises a plain Error, not RemoveAttachmentError, on a 404 (attachment unknown/not owned)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(404, { error: "NOT_FOUND", message: "Not found." }),
      ),
    );

    const promise = removeAttachment(1, 5, "ok reason");
    await expect(promise).rejects.not.toBeInstanceOf(RemoveAttachmentError);
    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  it("raises a plain Error, not RemoveAttachmentError, on a 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(500, { error: "INTERNAL", message: "Broke." })),
    );

    const promise = removeAttachment(1, 5, "ok reason");
    await expect(promise).rejects.not.toBeInstanceOf(RemoveAttachmentError);
    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  it("sends the reason as a JSON body with Content-Type and X-Requester-Id headers (api-spec.md §1.2, §4.4)", async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse(200, {
        ...REMOVABLE_ATTACHMENT,
        isRemoved: true,
        removedAt: "2026-09-02T03:15:00.000Z",
        removedReason: "ok reason",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await removeAttachment(9, 5, "ok reason");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/attachments/5");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toMatchObject({
      "X-Requester-Id": "9",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({ reason: "ok reason" });
  });
});

// --- Slice 14d: per-attachment Download / Preview, and Add-attachment. ---
//
// tests.md rows touched: C-21 (Download present on active rows — the
// button now actually does something), C-17 (Add disabled at 5). The rest
// are behaviours the task pins that no tests.md row spells out verbatim:
// the download request shape + Content-Disposition handling, a 410 on
// download surfaced not crashed, the preview lightbox, and immediate
// upload on Ticket Detail.

const DOWNLOAD_URL = (id: number) =>
  `${API_BASE_URL}/api/attachments/${id}/download`;

/** A `Response` stand-in carrying a Blob body + a Content-Disposition header. */
function blobResponse(
  status: number,
  {
    body = new Blob(["file-bytes"], { type: "application/pdf" }),
    contentDisposition,
    jsonBody,
  }: {
    body?: Blob;
    contentDisposition?: string;
    jsonBody?: unknown;
  } = {},
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

/** jsdom has no object-URL support — stub it so saveBlob / the lightbox work. */
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

describe("downloadAttachment (api-spec.md §4.3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /api/attachments/:id/download with the X-Requester-Id header and returns the blob + Content-Disposition filename", async () => {
    const pdfBlob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const fetchMock = vi.fn(() =>
      blobResponse(200, {
        body: pdfBlob,
        contentDisposition: 'attachment; filename="battery-report.pdf"',
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadAttachment(9, 42);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/attachments/42/download");
    expect(init.headers).toMatchObject({ "X-Requester-Id": "9" });
    expect(result.blob).toBe(pdfBlob);
    expect(result.filename).toBe("battery-report.pdf");
  });

  it("returns filename: null when the response carries no Content-Disposition (caller falls back to originalFilename)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => blobResponse(200, {})));

    const result = await downloadAttachment(1, 1);
    expect(result.filename).toBeNull();
  });

  it("raises AttachmentRemovedError (not a generic Error) on a 410 ATTACHMENT_REMOVED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        blobResponse(410, {
          jsonBody: {
            error: "ATTACHMENT_REMOVED",
            message: "This attachment has been removed.",
          },
        }),
      ),
    );

    const promise = downloadAttachment(1, 5);
    await expect(promise).rejects.toBeInstanceOf(AttachmentRemovedError);
    await expect(promise).rejects.toHaveProperty(
      "message",
      "This attachment has been removed.",
    );
  });

  it.each([
    [404, "not owned / unknown"],
    [500, "server fault"],
  ])("raises a plain Error, not AttachmentRemovedError, on a %i (%s)", async (status) => {
    vi.stubGlobal("fetch", vi.fn(() => blobResponse(status, {})));

    const promise = downloadAttachment(1, 5);
    await expect(promise).rejects.toBeInstanceOf(Error);
    await expect(promise).rejects.not.toBeInstanceOf(AttachmentRemovedError);
  });
});

describe("filenameFromContentDisposition", () => {
  it.each([
    ['attachment; filename="battery-report.pdf"', "battery-report.pdf"],
    ["attachment; filename=plain.png", "plain.png"],
    [
      "attachment; filename*=UTF-8''caf%C3%A9%20menu.pdf",
      "café menu.pdf",
    ],
    ['inline; filename="a b.webp"', "a b.webp"],
  ])("parses %j -> %j", (header, expected) => {
    expect(filenameFromContentDisposition(header)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["attachment"]])(
    "returns null for %j",
    (header) => {
      expect(filenameFromContentDisposition(header)).toBeNull();
    },
  );
});

describe("Attachment download wiring on Ticket Detail (AC-33)", () => {
  let clicked: { href: string; download: string }[];
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clicked = [];
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
      });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("clicking Download fetches the bytes and saves them under the Content-Disposition filename", async () => {
    installObjectUrlStub();
    const fetchMock = vi.fn(() =>
      blobResponse(200, {
        contentDisposition: 'attachment; filename="server-name.pdf"',
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(
      DOWNLOAD_URL(REMOVABLE_ATTACHMENT.id),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Requester-Id": "7" }),
      }),
    );
    // Server-provided name wins over the attachment's own originalFilename.
    expect(clicked[0].download).toBe("server-name.pdf");
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("falls back to the attachment's originalFilename when the response has no Content-Disposition", async () => {
    installObjectUrlStub();
    vi.stubGlobal("fetch", vi.fn(() => blobResponse(200, {})));

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0].download).toBe(REMOVABLE_ATTACHMENT.originalFilename);
  });

  it("surfaces a role=alert (does not crash) when the attachment was removed between page load and click (410)", async () => {
    installObjectUrlStub();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        blobResponse(410, {
          jsonBody: {
            error: "ATTACHMENT_REMOVED",
            message: "This attachment has been removed.",
          },
        }),
      ),
    );

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/was removed/i);
    // No download was triggered, and the row is still on screen.
    expect(clicked).toHaveLength(0);
    expect(
      screen.getByText(REMOVABLE_ATTACHMENT.originalFilename),
    ).toBeInTheDocument();
  });

  it("surfaces a role=alert on a non-410 download failure", async () => {
    installObjectUrlStub();
    vi.stubGlobal("fetch", vi.fn(() => blobResponse(500, {})));

    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not download/i,
    );
  });
});

const ACTIVE_IMAGE_ROW: TicketAttachment = {
  id: 2,
  originalFilename: "photo.png",
  mimeType: "image/png",
  fileSize: 819200,
  isRemoved: false,
  removedAt: null,
  removedReason: null,
  createdAt: "2026-09-01T08:16:00.000Z",
};

describe("Image preview lightbox (ui-spec.md §10, BR-34)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Preview on an image row opens an accessible modal lightbox that fetches and shows the image", async () => {
    installObjectUrlStub();
    const imageBlob = new Blob(["img"], { type: "image/png" });
    const fetchMock = vi.fn(() => blobResponse(200, { body: imageBlob }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness initialAttachments={[ACTIVE_IMAGE_ROW]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("photo.png");

    expect(fetchMock).toHaveBeenCalledWith(
      DOWNLOAD_URL(ACTIVE_IMAGE_ROW.id),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Requester-Id": "7" }),
      }),
    );

    const img = await within(dialog).findByRole("img", { name: "photo.png" });
    expect(img).toHaveAttribute("src", expect.stringMatching(/^blob:mock/));
  });

  it("Esc closes the lightbox and returns focus to the triggering Preview button; the object URL is revoked", async () => {
    const stub = installObjectUrlStub();
    vi.stubGlobal("fetch", vi.fn(() => blobResponse(200, {
      body: new Blob(["img"], { type: "image/png" }),
    })));

    render(
      <AttachmentSectionHarness initialAttachments={[ACTIVE_IMAGE_ROW]} />,
    );
    const previewButton = screen.getByRole("button", { name: /^preview$/i });
    fireEvent.click(previewButton);

    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(previewButton).toHaveFocus();
    await vi.waitFor(() =>
      expect(stub.revoked.length).toBeGreaterThan(0),
    );
  });

  it("the Close button also closes the lightbox", async () => {
    installObjectUrlStub();
    vi.stubGlobal("fetch", vi.fn(() => blobResponse(200, {
      body: new Blob(["img"], { type: "image/png" }),
    })));

    render(
      <AttachmentSectionHarness initialAttachments={[ACTIVE_IMAGE_ROW]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a role=alert inside the lightbox when the image fails to load", async () => {
    installObjectUrlStub();
    vi.stubGlobal("fetch", vi.fn(() => blobResponse(500, {})));

    render(
      <AttachmentSectionHarness initialAttachments={[ACTIVE_IMAGE_ROW]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /could not load this preview/i,
    );
  });
});

describe("Add attachment on Ticket Detail (AC-20, ui-spec.md §10)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function uploadResponse(fileName: string): Promise<Response> {
    return jsonResponse(201, {
      id: Math.floor(Math.random() * 1e6),
      ticketId: 1,
      originalFilename: fileName,
      mimeType: "application/pdf",
      fileSize: 2048,
      isRemoved: false,
      removedAt: null,
      removedReason: null,
      createdAt: "2026-09-02T08:15:10.000Z",
    });
  }

  it("uploads a selected valid file immediately and adds its row (no submit step)", async () => {
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (
        input === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST"
      ) {
        return uploadResponse("added.pdf");
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness
        initialAttachments={[REMOVABLE_ATTACHMENT]}
        withUpload
      />,
    );

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("added.pdf", 2048, "application/pdf")] },
    });

    expect(await screen.findByText("added.pdf")).toBeInTheDocument();
    const uploadCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit?]) =>
        url === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST",
    );
    expect(uploadCalls).toHaveLength(1);
  });

  it("disables the Add control with the 'Maximum of 5 active attachments' tooltip once 5 active attachments exist (AC-20)", () => {
    const fiveActive: TicketAttachment[] = Array.from({ length: 5 }, (_, i) => ({
      ...REMOVABLE_ATTACHMENT,
      id: 100 + i,
      originalFilename: `f${i}.pdf`,
    }));

    render(
      <AttachmentSectionHarness initialAttachments={fiveActive} withUpload />,
    );

    const addButton = screen.getByRole("button", { name: /add attachment/i });
    expect(addButton).toBeDisabled();
    expect(addButton).toHaveAttribute(
      "title",
      "Maximum of 5 active attachments",
    );
  });

  it("counts only active attachments toward the ceiling — 4 active + 2 removed still allows Add", () => {
    const mixed: TicketAttachment[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        ...REMOVABLE_ATTACHMENT,
        id: 200 + i,
        originalFilename: `a${i}.pdf`,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        ...REMOVABLE_ATTACHMENT,
        id: 300 + i,
        originalFilename: `r${i}.pdf`,
        isRemoved: true,
        removedAt: "2026-09-01T02:02:00.000Z",
        removedReason: "gone",
      })),
    ];

    render(<AttachmentSectionHarness initialAttachments={mixed} withUpload />);
    expect(
      screen.getByRole("button", { name: /add attachment/i }),
    ).toBeEnabled();
  });

  it("renders a failed-upload row (file name + 'Upload failed — retry') when the server rejects the upload, and adds no active row", async () => {
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (
        input === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST"
      ) {
        return jsonResponse(500, {});
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness
        initialAttachments={[REMOVABLE_ATTACHMENT]}
        withUpload
      />,
    );

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("broken.pdf", 2048, "application/pdf")] },
    });

    const group = await screen.findByRole("alert");
    expect(group).toHaveTextContent("broken.pdf");
    expect(group).toHaveTextContent("Upload failed — retry");
    expect(within(group).getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(within(group).getByRole("button", { name: "Dismiss" })).toBeEnabled();

    // No active AttachmentList row for the failed file — only the
    // pre-existing attachment has a Download control.
    expect(
      screen.getAllByRole("button", { name: /download/i }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /add attachment/i }),
    ).toBeEnabled();
  });

  it("Retry on a failed-upload row re-attempts the upload; on success the row disappears and the active attachment is reported", async () => {
    let attempts = 0;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (
        input === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST"
      ) {
        attempts += 1;
        return attempts === 1
          ? jsonResponse(500, {})
          : uploadResponse("retried.pdf");
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness
        initialAttachments={[REMOVABLE_ATTACHMENT]}
        withUpload
      />,
    );

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("retried.pdf", 2048, "application/pdf")] },
    });

    const group = await screen.findByRole("alert");
    fireEvent.click(within(group).getByRole("button", { name: "Retry" }));

    // The failed row is gone and a real active row (with its own Download
    // control) appeared alongside the pre-existing attachment's.
    await vi.waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /download/i }),
      ).toHaveLength(2),
    );
    expect(
      screen.queryByText("Upload failed — retry"),
    ).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("Dismiss removes the failed-upload row and does nothing else (no upload, no attachment added)", async () => {
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (
        input === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST"
      ) {
        return jsonResponse(500, {});
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness
        initialAttachments={[REMOVABLE_ATTACHMENT]}
        withUpload
      />,
    );

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("gone.pdf", 2048, "application/pdf")] },
    });

    const group = await screen.findByRole("alert");
    fireEvent.click(within(group).getByRole("button", { name: "Dismiss" }));

    expect(
      screen.queryByText("Upload failed — retry"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("gone.pdf")).not.toBeInTheDocument();
    // Only the initial upload attempt was made — Dismiss never uploads.
    const uploadCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit?]) =>
        url === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST",
    );
    expect(uploadCalls).toHaveLength(1);
    // No active row was added for the dismissed file.
    expect(
      screen.getAllByRole("button", { name: /download/i }),
    ).toHaveLength(1);
  });

  it("a 409 ATTACHMENT_LIMIT rejection surfaces the 'Maximum of 5 active attachments' wording in the failed-row area", async () => {
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (
        input === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST"
      ) {
        return jsonResponse(409, {
          error: "ATTACHMENT_LIMIT",
          message: "Ticket already has 5 active attachments.",
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness
        initialAttachments={[REMOVABLE_ATTACHMENT]}
        withUpload
      />,
    );

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("sixth.pdf", 2048, "application/pdf")] },
    });

    const group = await screen.findByRole("alert");
    expect(group).toHaveTextContent("Maximum of 5 active attachments");
    expect(group).toHaveTextContent("sixth.pdf");
    expect(group).toHaveTextContent("Upload failed — retry");
    // The existing row is still there and the Add control still works.
    expect(
      screen.getByText(REMOVABLE_ATTACHMENT.originalFilename),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add attachment/i }),
    ).toBeEnabled();
  });

  it("selecting two files where the first fails: the failed one gets a row and the batch stops (second file not uploaded)", async () => {
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (
        input === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST"
      ) {
        return jsonResponse(500, {});
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachmentSectionHarness
        initialAttachments={[REMOVABLE_ATTACHMENT]}
        withUpload
      />,
    );

    fireEvent.change(getFileInput(), {
      target: {
        files: [
          makeFile("first.pdf", 2048, "application/pdf"),
          makeFile("second.pdf", 2048, "application/pdf"),
        ],
      },
    });

    const group = await screen.findByRole("alert");
    expect(group).toHaveTextContent("first.pdf");
    expect(group).toHaveTextContent("Upload failed — retry");
    // Batch stopped on the first failure: second.pdf was never attempted
    // and has no row.
    expect(screen.queryByText("second.pdf")).not.toBeInTheDocument();
    const uploadCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit?]) =>
        url === `${API_BASE_URL}/api/tickets/1/attachments` &&
        init?.method === "POST",
    );
    expect(uploadCalls).toHaveLength(1);
  });

  it("does not render the Add control when onAttachmentAdded is not provided", () => {
    render(
      <AttachmentSectionHarness initialAttachments={[REMOVABLE_ATTACHMENT]} />,
    );
    expect(
      screen.queryByRole("button", { name: /add attachment/i }),
    ).not.toBeInTheDocument();
  });
});
