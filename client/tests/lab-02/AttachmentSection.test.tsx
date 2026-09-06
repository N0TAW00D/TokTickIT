import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  AttachmentUploader,
  type QueuedAttachment,
} from "../../src/components/AttachmentUploader.tsx";
import { CreateTicketScreen } from "../../src/screens/CreateTicketScreen.tsx";
import {
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";
import {
  uploadAttachment,
  UploadAttachmentError,
} from "../../src/tickets/api.ts";

// Covers docs/lab-02/tests.md rows C-15 (attachment client validation),
// C-16 (partial attachment failure after a successful create), and C-17
// (add-attachment disabled at the 5-attachment ceiling).

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

    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("screenshot.png");
    expect(warning).toHaveTextContent("could not be uploaded");

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

    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("bad.png");
    expect(warning).not.toHaveTextContent("good.pdf");

    const attachmentCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit?]) =>
        url === ATTACHMENTS_URL && init?.method === "POST",
    );
    expect(attachmentCalls).toHaveLength(2);
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
