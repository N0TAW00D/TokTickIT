import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { CreateTicketScreen } from "../../src/screens/CreateTicketScreen.tsx";
import {
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";

// Covers docs/lab-02/tests.md rows C-09 through C-14. This slice adds C-09
// (form load + reference data); validation (C-10, C-11) and submit
// handling (C-12, C-13, C-14) land in the next two slices. Attachments
// (C-15, C-16, C-17) belong to the AttachmentUploader built in Issue #17 —
// this screen only renders the placeholder section from ui-spec.md §8.

const API_BASE_URL = "http://localhost:3000";
const CATEGORIES_URL = `${API_BASE_URL}/api/categories`;
const RELATED_SYSTEMS_URL = `${API_BASE_URL}/api/related-systems`;

const CATEGORIES = [
  { id: 1, name: "Hardware" },
  { id: 2, name: "Software" },
];

const RELATED_SYSTEMS = [
  { id: 10, name: "Email" },
  { id: 20, name: "Campus Wi-Fi" },
];

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
}

function mockFetch({ categories, relatedSystems }: MockFetchOptions = {}) {
  const fetchMock = vi.fn((input: string) => {
    if (input === CATEGORIES_URL) {
      return (categories ?? (() => jsonResponse(200, CATEGORIES)))();
    }
    if (input === RELATED_SYSTEMS_URL) {
      return (relatedSystems ?? (() => jsonResponse(200, RELATED_SYSTEMS)))();
    }
    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
