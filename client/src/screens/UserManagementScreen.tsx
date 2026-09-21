import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { SelectField, type SelectOption } from "../components/SelectField";
import { TextInput } from "../components/TextInput";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { NoResultsState } from "../components/NoResultsState";
import { RoleBadge } from "../components/RoleBadge";
import { UserDialog } from "../components/UserDialog";
import { fetchUsers, type AdminUser } from "../users/api";
import type { Role } from "../auth/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import "./UserManagementScreen.css";

/**
 * Table (`≥ 768px`) / card (`< 768px`) breakpoint. Unlike
 * `StaffTicketQueueScreen.tsx` (which also has a `768–991px` tablet table
 * that drops a column), User Management has no tablet-specific column
 * dropping requirement (ui-spec.md §12) — this is a simple two-way split,
 * same query, same "exactly one markup in the DOM" rationale as that
 * screen's own `DESKTOP_QUERY`.
 */
const DESKTOP_QUERY = "(min-width: 768px)";

/** Search → `search` param debounce delay, same convention as `StaffTicketQueueScreen.tsx`. */
const SEARCH_DEBOUNCE_MS = 300;

type ListState =
  | { phase: "loading" }
  | { phase: "loaded"; users: AdminUser[] }
  | { phase: "error"; message: string };

/**
 * Which of the two "list came back empty" presentations (ui-spec.md §11
 * States paragraph) applies — mirrors `StaffTicketQueueScreen.tsx`'s own
 * `classifyQueue`, simplified to this screen's single `users: []` source
 * (no separate `totalItems`, since `fetchUsers` returns the whole matching
 * set with no pagination).
 *
 * - `empty`: zero users exist at all, no active search/role filter
 *   (ui-spec.md §11: "unreachable in practice, still implemented").
 * - `noResults`: a search/filter is active and matched nothing.
 */
type UserListVariant = "rows" | "empty" | "noResults";

function classifyUsers(users: AdminUser[], hasActiveQuery: boolean): UserListVariant {
  if (users.length > 0) return "rows";
  return hasActiveQuery ? "noResults" : "empty";
}

const ROLE_OPTIONS: SelectOption[] = [
  { value: "REQUESTER", label: "Requester" },
  { value: "IT_STAFF", label: "IT Staff" },
  { value: "ADMINISTRATOR", label: "Administrator" },
];

/**
 * Seam for the Create/Edit dialogs a later dispatch adds (this dispatch
 * builds list mode only). `{ kind: "none" }` renders nothing extra;
 * `"create"` and `"edit"` are set by the "New user" button and each row's
 * Edit action respectively, and are the exact two non-`"none"` states the
 * later dispatch's dialog component switches on.
 */
export type DialogMode =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; user: AdminUser };

/** Plain two-state label (ui-spec.md §11: "Status (Active / Inactive badge)") — no dedicated shared component exists yet for a single-screen two-state badge, so this reuses the existing `zen-badge` shell classes directly. */
function ActiveStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`zen-badge ${isActive ? "zen-user-mgmt__badge--active" : "zen-user-mgmt__badge--inactive"}`}>
      <span className="zen-badge__label">{isActive ? "Active" : "Inactive"}</span>
    </span>
  );
}

interface UserTableProps {
  users: AdminUser[];
  onEdit: (user: AdminUser) => void;
}

/** Desktop table (ui-spec.md §11): Name, Email, Role, Status, Edit action. Real `<th scope="col">` per §13. */
function UserTable({ users, onEdit }: UserTableProps) {
  return (
    <div className="zen-user-mgmt__table-scroll">
      <table className="zen-user-mgmt__table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="zen-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td className="zen-user-mgmt__truncate" title={user.email}>
                {user.email}
              </td>
              <td>
                <RoleBadge value={user.role} />
              </td>
              <td>
                <ActiveStatusBadge isActive={user.isActive} />
              </td>
              <td>
                <Button variant="secondary" onClick={() => onEdit(user)}>
                  Edit
                  <span className="zen-visually-hidden"> {user.name}</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mobile cards (`< 768px`, ui-spec.md §12): same fields as the table, following `StaffTicketQueueScreen.tsx`'s card markup convention (simpler here — no priority/status colour-coding beyond the role/active labels). */
function UserCards({ users, onEdit }: UserTableProps) {
  return (
    <ul className="zen-user-mgmt__cards">
      {users.map((user) => (
        <li key={user.id} className="zen-user-mgmt__card">
          <div className="zen-user-mgmt__card-header">
            <span className="zen-user-mgmt__card-name">{user.name}</span>
            <ActiveStatusBadge isActive={user.isActive} />
          </div>

          <p className="zen-user-mgmt__card-email zen-user-mgmt__truncate" title={user.email}>
            {user.email}
          </p>

          <div className="zen-user-mgmt__card-meta">
            <RoleBadge value={user.role} />
          </div>

          <Button
            variant="secondary"
            className="zen-user-mgmt__card-edit"
            onClick={() => onEdit(user)}
          >
            Edit
            <span className="zen-visually-hidden"> {user.name}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Administrator User Management screen (ui-spec.md §11, `/admin/users`) —
 * list mode (search + Role filter, the table/card responsive split, and
 * every list-mode feedback state: loading, empty, no-results, failure) plus
 * the Create/Edit `UserDialog` (../components/UserDialog.tsx), rendered at
 * the seam below and driven by `mode`. The forbidden state (ui-spec.md
 * §4.3) is handled entirely by the `RequireRole` wrapper this screen is
 * mounted under (see RequireRole.tsx), not here.
 *
 * `UserDialog` calls `onSaved`/`onCancel` rather than closing itself; both
 * paths run through `closeDialog` here, which resets `mode` back to
 * `{ kind: "none" }` and restores focus to whichever button opened it
 * (`dialogTriggerRef`) — `onSaved` additionally calls `refetch()` first.
 */
export function UserManagementScreen() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [state, setState] = useState<ListState>({ phase: "loading" });

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState("");

  const [mode, setMode] = useState<DialogMode>({ kind: "none" });

  /**
   * Whichever button opened the dialog ("New user" or a row's Edit), so it
   * can regain focus when the dialog closes (ui-spec.md §13: "confirm
   * dialogs trap focus and restore it"). Captured via `document.activeElement`
   * inside handleNewUser/handleEditUser rather than threading a ref through
   * UserTable/UserCards' `onEdit` prop: a click synchronously focuses its
   * button before the click handler runs, so at the top of either handler
   * `document.activeElement` is already the exact trigger — same
   * lookup-by-DOM-state idea as StaffTicketDetailScreen.tsx's
   * `restoreStatusFocus`, just via the active element instead of a stable id.
   */
  const dialogTriggerRef = useRef<HTMLElement | null>(null);

  const isLoading = state.phase === "loading";

  const isFiltersDefault = searchInput === "" && role === "";

  const hasActiveQuery = debouncedSearch.trim() !== "" || role !== "";

  const previousSearchRef = useRef(searchInput.trim());

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      previousSearchRef.current = searchInput.trim();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /**
   * Fetch/refetch function, stable across renders via `useCallback` (only
   * changes when `debouncedSearch`/`role` actually change) so the later
   * dispatch's dialog-success handler can hold it in scope and call it
   * without re-deriving it fresh — same convention as
   * `StaffTicketQueueScreen.tsx`'s own `load`.
   */
  const refetch = useCallback(() => {
    setState({ phase: "loading" });
    fetchUsers({
      search: debouncedSearch,
      role: role ? (role as Role) : undefined,
    })
      .then((users) => {
        setState({ phase: "loaded", users });
      })
      .catch(() => {
        setState({
          phase: "error",
          message: "Could not load users. Please check your connection and try again.",
        });
      });
  }, [debouncedSearch, role]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  function handleRoleChange(value: string) {
    setRole(value);
  }

  function handleClearFilters() {
    setSearchInput("");
    setDebouncedSearch("");
    setRole("");
  }

  function handleNewUser() {
    dialogTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMode({ kind: "create" });
  }

  function handleEditUser(user: AdminUser) {
    dialogTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMode({ kind: "edit", user });
  }

  /** Closes the dialog and restores focus to whichever button opened it — used both by Cancel/Esc and by a successful save. */
  function closeDialog() {
    setMode({ kind: "none" });
    dialogTriggerRef.current?.focus();
    dialogTriggerRef.current = null;
  }

  function handleDialogCancel() {
    closeDialog();
  }

  function handleDialogSaved() {
    refetch();
    closeDialog();
  }

  const variant: UserListVariant =
    state.phase === "loaded" ? classifyUsers(state.users, hasActiveQuery) : "rows";

  // Mirrors My Tickets / Staff Queue: nothing to search or filter yet when
  // there are no users at all (unreachable in practice per ui-spec.md §11,
  // but kept consistent with the other list screens regardless).
  const hideControls = variant === "empty";

  return (
    <AppShell>
      <div className="zen-user-mgmt__header">
        <div>
          <h1>User Management</h1>
          <p className="zen-user-mgmt__intro">
            Create, edit and deactivate user accounts.
          </p>
        </div>
        <div className="zen-user-mgmt__header-actions">
          {!isFiltersDefault && (
            <Button variant="tertiary" onClick={handleClearFilters} disabled={isLoading}>
              Clear filters
            </Button>
          )}
          <Button variant="primary" onClick={handleNewUser}>
            New user
          </Button>
        </div>
      </div>

      {!hideControls && (
        <div className="zen-user-mgmt__controls">
          <div className="zen-user-mgmt__search-field">
            <label htmlFor="user-mgmt-search" className="zen-visually-hidden">
              Search
            </label>
            <TextInput
              id="user-mgmt-search"
              type="search"
              placeholder="Search by name or email"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="zen-user-mgmt__filters">
            <SelectField
              id="user-mgmt-role"
              label="Role"
              value={role}
              onChange={handleRoleChange}
              placeholder="All Roles"
              disabled={isLoading}
              options={ROLE_OPTIONS}
            />
          </div>
        </div>
      )}

      {state.phase === "loading" && <LoadingState label="Loading users…" />}

      {state.phase === "error" && <ErrorState message={state.message} onRetry={refetch} />}

      {state.phase === "loaded" && variant === "rows" && (
        isDesktop ? (
          <UserTable users={state.users} onEdit={handleEditUser} />
        ) : (
          <UserCards users={state.users} onEdit={handleEditUser} />
        )
      )}

      {state.phase === "loaded" && variant === "empty" && (
        <EmptyState title="There are no users yet" />
      )}

      {state.phase === "loaded" && variant === "noResults" && (
        <NoResultsState
          message="No users match these filters"
          onClearFilters={handleClearFilters}
          clearFiltersLabel="Clear filters"
        />
      )}

      {mode.kind !== "none" && (
        <UserDialog mode={mode} onCancel={handleDialogCancel} onSaved={handleDialogSaved} />
      )}
    </AppShell>
  );
}
