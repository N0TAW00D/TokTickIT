import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { UserManagementScreen } from "../../src/screens/UserManagementScreen.tsx";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.tsx";
import type { AuthUser } from "../../src/auth/api.ts";
import type { AdminUser } from "../../src/users/api.ts";

// Covers docs/lab-03/ui-spec.md §11 (List mode + States), §12 (responsive
// table/card split) and §13 (a11y: real <th scope="col"> headers), plus
// specification.md's Administrator User Management Acceptance Criteria
// AC-45 (Name/Email/Role/Status/Edit columns), AC-46 (search), AC-47 (role
// filter) and AC-55's non-forbidden half (an Administrator CAN reach this
// screen — the "both are refused" half for Requester/IT Staff is
// RequireRole's own territory, per the comment atop UserManagementScreen.tsx).
//
// LIST MODE ONLY. A later dispatch appends dialog-behavior tests (create/edit
// submission, validation, guard-rails) to this same file — see the fixture
// exports and `mockFetch` below, which are written to be reused/extended by
// that dispatch rather than redefined.

const API_BASE_URL = "http://localhost:3000";
const USERS_URL = `${API_BASE_URL}/api/users`;

/**
 * Canonical fixture users, already in the name-ascending order the real
 * server returns them (api-spec.md §6.1: `orderBy: { name: 'asc' }` in
 * server/src/routes/users.ts). `FIXTURE_ADMIN_SELF` (id 1) is the exact same
 * id `renderScreen()` below logs the seeded Administrator in as — a later
 * dispatch testing UserDialog's self-deactivation guard-rail (BR-31, AC-53)
 * should edit THIS row to hit the "editing yourself" branch, and
 * `FIXTURE_IT_STAFF`/`FIXTURE_REQUESTER` (ids 2/3) for the "editing someone
 * else" branch.
 */
export const FIXTURE_ADMIN_SELF: AdminUser = {
  id: 1,
  name: "Nat Rivera",
  email: "nat.rivera@example.edu",
  role: "ADMINISTRATOR",
  isActive: true,
  mustChangePassword: false,
};

export const FIXTURE_IT_STAFF: AdminUser = {
  id: 2,
  name: "Casey Alders",
  email: "casey.alders@example.edu",
  role: "IT_STAFF",
  isActive: true,
  mustChangePassword: false,
};

export const FIXTURE_REQUESTER: AdminUser = {
  id: 3,
  name: "Bree Chen",
  email: "bree.chen@example.edu",
  role: "REQUESTER",
  isActive: false,
  mustChangePassword: true,
};

/** name-ascending: Bree Chen, Casey Alders, Nat Rivera. */
export const FIXTURE_USERS: AdminUser[] = [
  FIXTURE_REQUESTER,
  FIXTURE_IT_STAFF,
  FIXTURE_ADMIN_SELF,
];

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/**
 * For a later dispatch's `POST /api/users/:id/initial-password` success
 * case: the real response is `204` with NO body, and
 * `setUserInitialPassword` never calls `response.json()` on that path — use
 * this instead of `jsonResponse` there. Exported (rather than removed as
 * "unused") specifically for that later dispatch; list-mode tests never
 * reach this route themselves.
 */
export function emptyResponse(status: number): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(undefined),
  } as Response);
}

type UsersListHandler = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * `vi.stubGlobal("fetch", ...)` mock covering every route in
 * `client/src/users/api.ts`. This dispatch only ever drives the
 * `GET /api/users` branch (via `usersListHandler`, defaulting to
 * `FIXTURE_USERS`); the POST/PATCH/POST-initial-password branches are left
 * as explicit seams — 404 stubs — for a later dispatch's dialog-behavior
 * tests to replace with their own handlers (following the same
 * `usersListHandler`-style optional-callback pattern) rather than
 * restructuring this function.
 */
function mockFetch(usersListHandler?: UsersListHandler) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = new URL(input);

    // GET /api/users — list (api-spec.md §6.1). The only route this
    // dispatch's tests exercise.
    if (url.pathname === "/api/users" && method === "GET") {
      return (usersListHandler ?? (() => jsonResponse(200, FIXTURE_USERS)))(
        input,
        init,
      );
    }

    // POST /api/users — create (api-spec.md §6.2). Seam for a later
    // dispatch: replace this 404 with a handler branching on the request
    // body (parse via `JSON.parse(init?.body as string)`).
    if (url.pathname === "/api/users" && method === "POST") {
      return jsonResponse(404, {});
    }

    // PATCH /api/users/:id — update (api-spec.md §6.3). Seam for a later
    // dispatch: match `/^\/api\/users\/(\d+)$/` against `url.pathname` to
    // recover `:id`, and branch on the request body for the
    // EMAIL_IN_USE/SELF_DEACTIVATION/LAST_ADMIN/VALIDATION_FAILED cases.
    if (/^\/api\/users\/\d+$/.test(url.pathname) && method === "PATCH") {
      return jsonResponse(404, {});
    }

    // POST /api/users/:id/initial-password (api-spec.md §6.4). Seam for a
    // later dispatch: match `/^\/api\/users\/(\d+)\/initial-password$/`,
    // and note the real success response is `204` with NO body — use
    // `emptyResponse(204)` (exported alongside this helper) rather than
    // `jsonResponse`, since `setUserInitialPassword` never calls
    // `response.json()` on the success path.
    if (/^\/api\/users\/\d+\/initial-password$/.test(url.pathname) && method === "POST") {
      return jsonResponse(404, {});
    }

    return jsonResponse(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Number of `GET /api/users` calls `fetchMock` has recorded. */
function listCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([input, init]: [string, RequestInit?]) => {
    const method = (init?.method ?? "GET").toUpperCase();
    return new URL(input).pathname === "/api/users" && method === "GET";
  }).length;
}

/** The `[url, init]` args of the Nth (1-indexed) `GET /api/users` call. */
function listCall(
  fetchMock: ReturnType<typeof vi.fn>,
  n: number,
): [string, RequestInit | undefined] {
  const calls = fetchMock.mock.calls.filter(([input, init]: [string, RequestInit?]) => {
    const method = (init?.method ?? "GET").toUpperCase();
    return new URL(input).pathname === "/api/users" && method === "GET";
  }) as [string, RequestInit | undefined][];
  return calls[n - 1];
}

/** Same technique as StaffTicketQueue.test.tsx: jsdom has no `matchMedia`, so this fixes it for one test's lifetime. Drives `UserManagementScreen.tsx`'s `DESKTOP_QUERY` (`"(min-width: 768px)"`). */
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

/**
 * Seeds AuthContext with an Administrator user before the screen mounts
 * (StaffTicketQueue.test.tsx's own `AuthBootstrap` pattern, adapted to
 * ADMINISTRATOR) — `UserDialog.tsx` calls `useAuth()` directly (for its
 * self-deactivation check), so the screen must never mount without this.
 * Id/name/email/role deliberately mirror `FIXTURE_ADMIN_SELF` exactly, so
 * that fixture row IS "self" from the logged-in user's point of view.
 */
function AuthBootstrap({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const adminUser: AuthUser = {
    id: FIXTURE_ADMIN_SELF.id,
    name: FIXTURE_ADMIN_SELF.name,
    email: FIXTURE_ADMIN_SELF.email,
    role: "ADMINISTRATOR",
    mustChangePassword: false,
  };
  useEffect(() => {
    if (!user) setUser(adminUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!user) return null;
  return <>{children}</>;
}

function renderScreen() {
  return render(
    <AuthProvider>
      <AuthBootstrap>
        <MemoryRouter initialEntries={["/admin/users"]}>
          <UserManagementScreen />
        </MemoryRouter>
      </AuthBootstrap>
    </AuthProvider>,
  );
}

beforeEach(() => {
  stubMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("UserManagementScreen — list mode", () => {
  describe("Loading state", () => {
    it("shows a role=status indicator and no table while the request is in flight", () => {
      mockFetch(() => new Promise(() => {}));
      renderScreen();

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("AC-45 desktop table render", () => {
    it("shows real th scope=col headers for Name/Email/Role/Status/Edit, with each fixture user's data", async () => {
      const fetchMock = mockFetch();
      renderScreen();

      const table = await screen.findByRole("table");
      const headers = within(table).getAllByRole("columnheader");
      expect(headers.map((header) => header.getAttribute("scope"))).toEqual([
        "col",
        "col",
        "col",
        "col",
        "col",
      ]);
      // Actions header text is visually-hidden but still present for a11y;
      // the other four carry the documented visible labels (AC-45).
      expect(headers.map((header) => header.textContent)).toEqual([
        "Name",
        "Email",
        "Role",
        "Status",
        "Actions",
      ]);

      const rows = within(table).getAllByRole("row");
      expect(rows).toHaveLength(4); // header + 3 fixture users

      // Name matches by `selector: "td"`: each name also appears a second
      // time as part of the row's Edit button's visually-hidden
      // "Edit <name>" label (UserTable's own accessible-name convention),
      // so a plain getByText would find two matches.
      expect(
        within(table).getByText("Bree Chen", { selector: "td" }),
      ).toBeInTheDocument();
      expect(within(table).getByText("bree.chen@example.edu")).toBeInTheDocument();
      expect(within(table).getByText("Requester")).toBeInTheDocument();
      expect(within(table).getByText("Inactive")).toBeInTheDocument();

      expect(
        within(table).getByText("Casey Alders", { selector: "td" }),
      ).toBeInTheDocument();
      expect(within(table).getByText("casey.alders@example.edu")).toBeInTheDocument();
      expect(within(table).getByText("IT Staff")).toBeInTheDocument();

      expect(
        within(table).getByText("Nat Rivera", { selector: "td" }),
      ).toBeInTheDocument();
      expect(within(table).getByText("nat.rivera@example.edu")).toBeInTheDocument();
      expect(within(table).getByText("Administrator")).toBeInTheDocument();

      // Two "Active" badges (Bree Chen's own inactive row asserted above).
      expect(within(table).getAllByText("Active")).toHaveLength(2);

      // Session-cookie scoped, same convention as every other admin/staff
      // fetch in this codebase.
      const [, init] = listCall(fetchMock, 1) as [string, RequestInit];
      expect(init.credentials).toBe("include");

      // Edit is a real <button>, not a link — no client-side navigation
      // (the screen opens a dialog in place, it never routes away).
      const editButtons = within(table).getAllByRole("button", { name: /^edit/i });
      expect(editButtons).toHaveLength(3);
      for (const button of editButtons) {
        expect(button.tagName).toBe("BUTTON");
      }
    });

    it("never renders a passwordHash value anywhere, even if the response body carried one", async () => {
      // Defense-in-depth: AdminUser never legitimately carries this field
      // (BR-06, AC-13), but if a server regression ever leaked it in the
      // JSON body, the screen must not surface it regardless.
      const leakyUser = {
        ...FIXTURE_ADMIN_SELF,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz0123456789",
      };
      mockFetch(() => jsonResponse(200, [leakyUser]));
      renderScreen();

      await screen.findByRole("table");
      expect(
        screen.queryByText(/\$2b\$10\$abcdefghijklmnopqrstuvwxyz0123456789/),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/passwordHash/i)).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain("passwordHash");
    });
  });

  describe("Mobile card layout (< 768px)", () => {
    it("renders one card per user with the same fields, and no table", async () => {
      stubMatchMedia(false);
      mockFetch();
      renderScreen();

      const cards = await screen.findAllByRole("listitem");
      expect(cards).toHaveLength(3);
      expect(screen.queryByRole("table")).not.toBeInTheDocument();

      const [breeCard, caseyCard, natCard] = cards;

      // Name matches by `selector` (same reasoning as the desktop table
      // test above): the name also appears inside the card's Edit button's
      // visually-hidden "Edit <name>" label.
      expect(
        within(breeCard).getByText("Bree Chen", {
          selector: ".zen-user-mgmt__card-name",
        }),
      ).toBeInTheDocument();
      expect(within(breeCard).getByText("bree.chen@example.edu")).toBeInTheDocument();
      expect(within(breeCard).getByText("Requester")).toBeInTheDocument();
      expect(within(breeCard).getByText("Inactive")).toBeInTheDocument();

      expect(
        within(caseyCard).getByText("Casey Alders", {
          selector: ".zen-user-mgmt__card-name",
        }),
      ).toBeInTheDocument();
      expect(within(caseyCard).getByText("IT Staff")).toBeInTheDocument();
      expect(within(caseyCard).getByText("Active")).toBeInTheDocument();

      expect(
        within(natCard).getByText("Nat Rivera", {
          selector: ".zen-user-mgmt__card-name",
        }),
      ).toBeInTheDocument();
      expect(within(natCard).getByText("Administrator")).toBeInTheDocument();

      const editButton = within(breeCard).getByRole("button", { name: /^edit/i });
      expect(editButton.tagName).toBe("BUTTON");
    });
  });

  describe("Empty state (\"There are no users yet\")", () => {
    it("shows EmptyState — not NoResultsState — and hides search/filter controls when zero users exist and no filter is active", async () => {
      mockFetch(() => jsonResponse(200, []));
      renderScreen();

      expect(
        await screen.findByRole("heading", { name: "There are no users yet" }),
      ).toBeInTheDocument();

      expect(
        screen.queryByText("No users match these filters"),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Search")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });

  describe("No-results state (\"No users match these filters\")", () => {
    it("shows NoResultsState when a search matches nothing; Clear filters resets the search box and role filter and refetches", async () => {
      const fetchMock = mockFetch((input) => {
        const search = new URL(input).searchParams.get("search");
        if (search === "zzzz") {
          return jsonResponse(200, []);
        }
        return jsonResponse(200, FIXTURE_USERS);
      });
      renderScreen();

      await screen.findByRole("table");
      expect(listCallCount(fetchMock)).toBe(1);

      vi.useFakeTimers();
      const searchInput = screen.getByLabelText("Search");
      fireEvent.change(searchInput, { target: { value: "zzzz" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      vi.useRealTimers();

      const message = await screen.findByText("No users match these filters");
      expect(listCallCount(fetchMock)).toBe(2);
      expect(
        screen.queryByText("There are no users yet"),
      ).not.toBeInTheDocument();

      // Filters stay visible/populated while showing no-results.
      expect(screen.getByLabelText("Search")).toHaveValue("zzzz");

      const noResultsRegion = message.parentElement as HTMLElement;
      const clearButton = within(noResultsRegion).getByRole("button", {
        name: /clear filters/i,
      });

      fireEvent.click(clearButton);
      await screen.findByRole("table");

      expect(listCallCount(fetchMock)).toBe(3);
      expect(screen.getByLabelText("Search")).toHaveValue("");
      expect(screen.getByLabelText("Role")).toHaveValue("");
      const params = new URL(listCall(fetchMock, 3)[0]).searchParams;
      expect(params.has("search")).toBe(false);
      expect(params.has("role")).toBe(false);
    });

    it("shows NoResultsState when a role filter matches nothing", async () => {
      const fetchMock = mockFetch((input) => {
        const role = new URL(input).searchParams.get("role");
        if (role === "IT_STAFF") {
          return jsonResponse(200, []);
        }
        return jsonResponse(200, FIXTURE_USERS);
      });
      renderScreen();

      await screen.findByRole("table");
      // Every fixture IT_STAFF user is actually returned in the default
      // mock, so filter to a role this particular handler stubs as empty.
      fireEvent.change(screen.getByLabelText("Role"), {
        target: { value: "IT_STAFF" },
      });

      await screen.findByText("No users match these filters");
      expect(listCallCount(fetchMock)).toBe(2);
      const params = new URL(listCall(fetchMock, 2)[0]).searchParams;
      expect(params.get("role")).toBe("IT_STAFF");
    });
  });

  describe("Failure state (ErrorState + Retry)", () => {
    it("shows role=alert with the documented message when the fetch rejects; Retry re-fetches and recovers", async () => {
      const fetchMock = mockFetch(() => Promise.reject(new Error("network down")));
      renderScreen();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Could not load users. Please check your connection and try again.",
      );
      expect(screen.queryByRole("table")).not.toBeInTheDocument();

      const retryButton = screen.getByRole("button", { name: /retry/i });
      fetchMock.mockImplementation((input: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (new URL(input).pathname === "/api/users" && method === "GET") {
          return jsonResponse(200, FIXTURE_USERS);
        }
        return jsonResponse(404, {});
      });

      fireEvent.click(retryButton);

      await screen.findByRole("table");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(listCallCount(fetchMock)).toBe(2);
    });

    it("also shows ErrorState on a 500 response (not just a network rejection)", async () => {
      mockFetch(() => jsonResponse(500, { error: "INTERNAL" }));
      renderScreen();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Could not load users. Please check your connection and try again.",
      );
    });
  });

  describe("Search and Role filter query params", () => {
    it("debounces the search box 300ms, sending exactly one request carrying the final value", async () => {
      const fetchMock = mockFetch();
      renderScreen();

      await screen.findByRole("table");
      expect(listCallCount(fetchMock)).toBe(1);

      vi.useFakeTimers();
      const searchInput = screen.getByLabelText("Search");
      fireEvent.change(searchInput, { target: { value: "c" } });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.change(searchInput, { target: { value: "ca" } });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.change(searchInput, { target: { value: "casey" } });
      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(listCallCount(fetchMock)).toBe(1);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(listCallCount(fetchMock)).toBe(2);

      const params = new URL(listCall(fetchMock, 2)[0]).searchParams;
      expect(params.get("search")).toBe("casey");

      vi.useRealTimers();
    });

    it("the Role filter fires a request carrying role, with no debounce", async () => {
      const fetchMock = mockFetch();
      renderScreen();

      await screen.findByRole("table");
      const initialParams = new URL(listCall(fetchMock, 1)[0]).searchParams;
      expect(initialParams.has("role")).toBe(false);

      fireEvent.change(screen.getByLabelText("Role"), {
        target: { value: "ADMINISTRATOR" },
      });
      await screen.findByRole("table");

      expect(listCallCount(fetchMock)).toBe(2);
      const params = new URL(listCall(fetchMock, 2)[0]).searchParams;
      expect(params.get("role")).toBe("ADMINISTRATOR");
    });

    it("combining search and role sends both query params on the same request", async () => {
      const fetchMock = mockFetch();
      renderScreen();

      await screen.findByRole("table");

      vi.useFakeTimers();
      fireEvent.change(screen.getByLabelText("Search"), {
        target: { value: "nat" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      vi.useRealTimers();

      expect(listCallCount(fetchMock)).toBe(2);

      fireEvent.change(screen.getByLabelText("Role"), {
        target: { value: "ADMINISTRATOR" },
      });
      await screen.findByRole("table");

      expect(listCallCount(fetchMock)).toBe(3);
      const params = new URL(listCall(fetchMock, 3)[0]).searchParams;
      expect(params.get("search")).toBe("nat");
      expect(params.get("role")).toBe("ADMINISTRATOR");
    });
  });

  describe("New user / Edit — dialog mode opens correctly (structural only)", () => {
    it("clicking New user opens a role=dialog labelled 'New user'", async () => {
      mockFetch();
      renderScreen();

      await screen.findByRole("table");
      fireEvent.click(screen.getByRole("button", { name: "New user" }));

      const dialog = await screen.findByRole("dialog");
      const labelledBy = dialog.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      const heading = document.getElementById(labelledBy as string);
      expect(heading).toHaveTextContent("New user");
      expect(heading?.textContent).not.toBe("Edit user");
    });

    it("clicking a row's Edit button opens a role=dialog labelled 'Edit user', scoped to that row's own trigger (not a link)", async () => {
      mockFetch();
      renderScreen();

      const table = await screen.findByRole("table");
      const rows = within(table).getAllByRole("row");
      // rows[0] is the header row; rows[1] is Bree Chen (first data row,
      // name-ascending).
      const breeRow = rows[1];
      const editButton = within(breeRow).getByRole("button", { name: /^edit/i });
      expect(editButton.tagName).toBe("BUTTON");
      expect(within(breeRow).queryByRole("link")).not.toBeInTheDocument();

      fireEvent.click(editButton);

      const dialog = await screen.findByRole("dialog");
      const labelledBy = dialog.getAttribute("aria-labelledby");
      const heading = document.getElementById(labelledBy as string);
      expect(heading).toHaveTextContent("Edit user");
    });
  });
});
