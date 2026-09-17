import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { SelectField, type SelectOption } from "../components/SelectField";
import { TextInput } from "../components/TextInput";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { NoResultsState } from "../components/NoResultsState";
import { Pagination, type PageSizeValue } from "../components/Pagination";
import { PriorityBadge } from "../components/PriorityBadge";
import { StatusBadge } from "../components/StatusBadge";
import { OwnerCell } from "../components/OwnerCell";
import { fetchCategories, type ReferenceOption } from "../tickets/api";
import { formatDateTime } from "../tickets/formatDateTime";
import { useAuth } from "../auth/AuthContext";
import {
  fetchStaffTickets,
  type ItPriority,
  type OwnerFilterValue,
  type StaffQueueStatus,
  type StaffSortDirection,
  type StaffSortField,
  type StaffTicketQueueItem,
} from "../staff/api";
import "./StaffTicketQueueScreen.css";

/** Search → `search` param debounce delay, matching My Tickets (ui-spec.md §9). */
const SEARCH_DEBOUNCE_MS = 300;

type ListState =
  | { phase: "loading" }
  | {
      phase: "loaded";
      items: StaffTicketQueueItem[];
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
    }
  | { phase: "error"; message: string };

/**
 * Which of the two "list came back empty" presentations (ui-spec.md §9
 * States table) applies. Both share `items: []` from the API — this is
 * derived from the response plus whether a search/filter query is active,
 * never from anything the caller can't see in the response.
 *
 * - `empty`: the queue holds zero tickets at all, no query active.
 * - `noResults`: covers both "an active search/filter matched nothing" and
 *   "the requested page is past the last one" — ui-spec.md §9 names only
 *   these two zero-item states for this screen (unlike My Tickets' three),
 *   so a past-the-end page is folded into the same "No tickets match these
 *   filters" presentation; its "Clear filters" action resets the page too.
 */
type QueueVariant = "rows" | "empty" | "noResults";

function classifyQueue(
  items: StaffTicketQueueItem[],
  totalItems: number,
  hasActiveQuery: boolean,
): QueueVariant {
  if (items.length > 0) return "rows";
  if (totalItems === 0 && !hasActiveQuery) return "empty";
  return "noResults";
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: "NEW", label: "New" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "WAITING_FOR_REQUESTER", label: "Waiting for Requester" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
  { value: "REOPENED", label: "Reopened" },
  { value: "CANCELLED", label: "Cancelled" },
];

const IT_PRIORITY_OPTIONS: SelectOption[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

/**
 * "Each active IT Staff" (ui-spec.md §9's third Owner option group) is not
 * included here — no endpoint exists yet to list IT Staff users (see this
 * dispatch's report). Anyone/Unassigned/Me is the full set until one does.
 */
const OWNER_OPTIONS: SelectOption[] = [
  { value: "unassigned", label: "Unassigned" },
  { value: "me", label: "Me" },
];

interface SortSelectOption extends SelectOption {
  sort: StaffSortField;
  direction: StaffSortDirection;
}

/**
 * The sort choices exposed here are exactly the three columns this table
 * makes sortable via their header buttons (IT Priority, Last Updated,
 * Ticket Number) — `createdAt` is a legal server sort field
 * (server/src/validation/staffTicketQueueQuery.ts) but Created Date is not
 * a column on this screen (ui-spec.md §9 drops it deliberately), so it is
 * left out of both the dropdown and the headers rather than sorting by a
 * column the user can't see.
 */
const SORT_OPTIONS: SortSelectOption[] = [
  { value: "itPriority-desc", label: "IT Priority (High to Low)", sort: "itPriority", direction: "desc" },
  { value: "itPriority-asc", label: "IT Priority (Low to High)", sort: "itPriority", direction: "asc" },
  { value: "updatedAt-desc", label: "Last Updated (newest)", sort: "updatedAt", direction: "desc" },
  { value: "updatedAt-asc", label: "Last Updated (oldest)", sort: "updatedAt", direction: "asc" },
  { value: "ticketNumber-asc", label: "Ticket Number (A→Z)", sort: "ticketNumber", direction: "asc" },
  { value: "ticketNumber-desc", label: "Ticket Number (Z→A)", sort: "ticketNumber", direction: "desc" },
];

const DEFAULT_SORT: StaffSortField = "itPriority";
const DEFAULT_DIRECTION: StaffSortDirection = "desc";
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE: PageSizeValue = 20;

/** The direction a sortable column header's first click applies (mirrors the server's own per-field default). */
const HEADER_DEFAULT_DIRECTION: Record<StaffSortField, StaffSortDirection> = {
  itPriority: "desc",
  updatedAt: "desc",
  ticketNumber: "asc",
  createdAt: "asc",
};

/** `createdAt`'s label is unused (no header renders it — see SORT_OPTIONS' comment) but kept so this stays a total `Record<StaffSortField, string>`. */
const COLUMN_LABEL: Record<StaffSortField, string> = {
  ticketNumber: "Ticket Number",
  itPriority: "IT Priority",
  updatedAt: "Last Updated",
  createdAt: "Created",
};

/**
 * Accessible name for a sortable column header's toggle button (ui-spec.md
 * §12/§13: icon-only sort affordances need an `aria-label` + `title`; the
 * visual caret is pure CSS, so this string is what actually names the
 * control for assistive tech and the hover tooltip).
 */
function sortToggleLabel(
  field: StaffSortField,
  activeSort: StaffSortField,
  activeDirection: StaffSortDirection,
): string {
  const label = COLUMN_LABEL[field];
  if (activeSort !== field) return `Sort by ${label}`;
  return activeDirection === "asc"
    ? `Sort by ${label}, ascending`
    : `Sort by ${label}, descending`;
}

/** `aria-sort` value for a sortable column's `<th>` (ui-spec.md §13). */
function ariaSortValue(
  field: StaffSortField,
  activeSort: StaffSortField,
  activeDirection: StaffSortDirection,
): "ascending" | "descending" | "none" {
  if (activeSort !== field) return "none";
  return activeDirection === "asc" ? "ascending" : "descending";
}

/** `data-sort-state` driving the ⇅ / ▲ / ▼ CSS content (StaffTicketQueueScreen.css). */
function sortState(
  field: StaffSortField,
  activeSort: StaffSortField,
  activeDirection: StaffSortDirection,
): "none" | StaffSortDirection {
  return activeSort === field ? activeDirection : "none";
}

function SortableHeader({
  field,
  sort,
  direction,
  onToggleSort,
  disabled,
}: {
  field: StaffSortField;
  sort: StaffSortField;
  direction: StaffSortDirection;
  onToggleSort: (field: StaffSortField) => void;
  disabled: boolean;
}) {
  const label = sortToggleLabel(field, sort, direction);
  return (
    <th scope="col" aria-sort={ariaSortValue(field, sort, direction)}>
      <button
        type="button"
        className="zen-staff-queue__sort-toggle"
        data-sort-state={sortState(field, sort, direction)}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => onToggleSort(field)}
      >
        {COLUMN_LABEL[field]}
      </button>
    </th>
  );
}

/** The seven desktop columns, in ui-spec.md §9's order — used for both the real header row and the loading skeleton. */
const COLUMN_HEADERS = [
  "Ticket Number",
  "Summary",
  "Category",
  "IT Priority",
  "Status",
  "Owner",
  "Last Updated",
] as const;

interface QueueTableProps {
  items: StaffTicketQueueItem[];
  sort: StaffSortField;
  direction: StaffSortDirection;
  onToggleSort: (field: StaffSortField) => void;
  disabled: boolean;
}

/**
 * Desktop table (ui-spec.md §9): exactly the seven columns the spec's
 * table lists, in that order. Created Date and Requested Priority are
 * deliberately absent (§9's rationale table).
 *
 * The whole row is a click target via the "stretched link" pattern used by
 * My Tickets (ui-spec.md §9 "follows Lab 2 My Tickets... for control
 * layout, pagination and state handling"): the ticket number's
 * `zen-staff-queue__row-link` gets a `::after` stretched over the row, and
 * a hidden "Actions" header plus an explicit "View" link give the same
 * affordance to assistive tech and keyboard users without a second visible
 * column.
 */
function QueueTable({ items, sort, direction, onToggleSort, disabled }: QueueTableProps) {
  return (
    <div className="zen-staff-queue__table-scroll">
      <table className="zen-staff-queue__table">
        <thead>
          <tr>
            <SortableHeader
              field="ticketNumber"
              sort={sort}
              direction={direction}
              onToggleSort={onToggleSort}
              disabled={disabled}
            />
            <th scope="col">Summary</th>
            <th scope="col">Category</th>
            <SortableHeader
              field="itPriority"
              sort={sort}
              direction={direction}
              onToggleSort={onToggleSort}
              disabled={disabled}
            />
            <th scope="col">Status</th>
            <th scope="col">Owner</th>
            <SortableHeader
              field="updatedAt"
              sort={sort}
              direction={direction}
              onToggleSort={onToggleSort}
              disabled={disabled}
            />
            <th scope="col">
              <span className="zen-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <Link
                  to={`/staff/tickets/${ticket.id}`}
                  className="zen-staff-queue__row-link"
                >
                  {ticket.ticketNumber}
                </Link>
              </td>
              <td
                className="zen-staff-queue__truncate zen-staff-queue__truncate--summary"
                title={ticket.summary}
              >
                {ticket.summary}
              </td>
              <td>{ticket.category.name}</td>
              <td>
                <PriorityBadge value={ticket.itPriority} variant="it" />
              </td>
              <td>
                <StatusBadge value={ticket.status} />
              </td>
              <td>
                <OwnerCell owner={ticket.owner} />
              </td>
              <td>{formatDateTime(ticket.updatedAt)}</td>
              <td>
                <Link
                  to={`/staff/tickets/${ticket.id}`}
                  className="zen-staff-queue__view-link"
                >
                  {"View "}
                  <span className="zen-visually-hidden">
                    ticket {ticket.ticketNumber}
                  </span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Loading skeleton (ui-spec.md §9: `role="status"` skeleton rows) — the
 * same seven-column table shape as the loaded state, with placeholder
 * blocks instead of real cells. The table itself is `aria-hidden` (it
 * carries no real information); the visually-hidden text is what actually
 * gets announced.
 */
function QueueLoadingSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="zen-staff-queue__table-scroll"
      role="status"
      aria-label="Loading ticket queue"
    >
      <span className="zen-visually-hidden">Loading ticket queue…</span>
      <table className="zen-staff-queue__table" aria-hidden="true">
        <thead>
          <tr>
            {COLUMN_HEADERS.map((label) => (
              <th scope="col" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {COLUMN_HEADERS.map((label) => (
                <td key={label}>
                  <span className="zen-staff-queue__skeleton-block" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * IT Staff Ticket Queue screen (ui-spec.md §9, `/staff/tickets`) —
 * desktop-width list mode only (the `< 768px` card layout is a separate
 * slice). Data fetch, controls (search/filter/sort/clear), pagination and
 * the loading/empty/no-results/failure states. The forbidden state
 * (ui-spec.md §4.3) is handled entirely by the `RequireRole` wrapper this
 * screen is mounted under, not here.
 */
export function StaffTicketQueueScreen() {
  const { user } = useAuth();
  const [state, setState] = useState<ListState>({ phase: "loading" });

  const [categories, setCategories] = useState<ReferenceOption[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [itPriority, setItPriority] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [owner, setOwner] = useState("");
  const [sort, setSort] = useState<StaffSortField>(DEFAULT_SORT);
  const [direction, setDirection] = useState<StaffSortDirection>(DEFAULT_DIRECTION);
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [pageSize, setPageSize] = useState<PageSizeValue>(DEFAULT_PAGE_SIZE);

  const isLoading = state.phase === "loading";

  const isFiltersDefault =
    searchInput === "" &&
    status === "" &&
    itPriority === "" &&
    categoryId === "" &&
    owner === "" &&
    sort === DEFAULT_SORT &&
    direction === DEFAULT_DIRECTION;

  const hasActiveQuery =
    debouncedSearch.trim() !== "" ||
    status !== "" ||
    itPriority !== "" ||
    categoryId !== "" ||
    owner !== "";

  // Reference data for the Category filter (`GET /api/categories`, not
  // staff-scoped) — loaded once, same as My Tickets. A failure here simply
  // leaves the Category filter at "All Categories" only.
  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  const previousSearchRef = useRef(searchInput.trim());

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      const normalizedSearch = searchInput.trim();
      if (normalizedSearch !== previousSearchRef.current) {
        setPage(DEFAULT_PAGE);
      }
      previousSearchRef.current = normalizedSearch;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  function resolveOwnerParam(): OwnerFilterValue | undefined {
    if (owner === "") return undefined;
    if (owner === "unassigned" || owner === "me") return owner;
    const id = Number(owner);
    return Number.isSafeInteger(id) ? id : undefined;
  }

  const load = useCallback(() => {
    setState({ phase: "loading" });
    fetchStaffTickets({
      search: debouncedSearch,
      status: status ? (status as StaffQueueStatus) : undefined,
      itPriority: itPriority ? (itPriority as ItPriority) : undefined,
      categoryId: categoryId ? Number(categoryId) : undefined,
      owner: resolveOwnerParam(),
      sort,
      direction,
      page,
      pageSize,
    })
      .then((response) => {
        setState({
          phase: "loaded",
          items: response.items,
          page: response.page,
          pageSize: response.pageSize,
          totalItems: response.totalItems,
          totalPages: response.totalPages,
        });
      })
      .catch(() => {
        setState({
          phase: "error",
          message: "Could not load the ticket queue. Please check your connection and try again.",
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status, itPriority, categoryId, owner, sort, direction, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  function handleToggleSort(field: StaffSortField) {
    if (sort === field) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(field);
      setDirection(HEADER_DEFAULT_DIRECTION[field]);
    }
    setPage(DEFAULT_PAGE);
  }

  function handleSortSelectChange(value: string) {
    const option = SORT_OPTIONS.find((candidate) => candidate.value === value);
    if (!option) return;
    setSort(option.sort);
    setDirection(option.direction);
    setPage(DEFAULT_PAGE);
  }

  function handleStatusChange(value: string) {
    setStatus(value);
    setPage(DEFAULT_PAGE);
  }

  function handleItPriorityChange(value: string) {
    setItPriority(value);
    setPage(DEFAULT_PAGE);
  }

  function handleCategoryChange(value: string) {
    setCategoryId(value);
    setPage(DEFAULT_PAGE);
  }

  function handleOwnerChange(value: string) {
    setOwner(value);
    setPage(DEFAULT_PAGE);
  }

  function handlePageChange(nextPage: number) {
    setPage(nextPage);
  }

  function handlePageSizeChange(nextPageSize: PageSizeValue) {
    setPageSize(nextPageSize);
    setPage(DEFAULT_PAGE);
  }

  function handleClearFilters() {
    setSearchInput("");
    setDebouncedSearch("");
    setStatus("");
    setItPriority("");
    setCategoryId("");
    setOwner("");
    setSort(DEFAULT_SORT);
    setDirection(DEFAULT_DIRECTION);
    setPage(DEFAULT_PAGE);
  }

  const categoryOptions = useMemo<SelectOption[]>(
    () =>
      categories.map((category) => ({
        value: String(category.id),
        label: category.name,
      })),
    [categories],
  );

  const variant: QueueVariant =
    state.phase === "loaded"
      ? classifyQueue(state.items, state.totalItems, hasActiveQuery)
      : "rows";

  // Nothing to search or filter yet when the queue holds no tickets at
  // all (mirrors My Tickets' AC-29 behaviour) — the noResults variant
  // keeps the bar visible/populated so the user can see and undo it.
  const hideControls = variant === "empty";

  return (
    <AppShell>
      <div className="zen-staff-queue__header">
        <div>
          <h1>Ticket Queue</h1>
          <p className="zen-staff-queue__intro">
            Every open ticket across all Requesters{user ? `, ${user.name}` : ""}.
          </p>
        </div>
        <div className="zen-staff-queue__header-actions">
          {!isFiltersDefault && (
            <Button variant="tertiary" onClick={handleClearFilters} disabled={isLoading}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {!hideControls && (
        <div className="zen-staff-queue__controls">
          <div className="zen-staff-queue__search-field">
            <label htmlFor="staff-queue-search" className="zen-visually-hidden">
              Search
            </label>
            <TextInput
              id="staff-queue-search"
              type="search"
              placeholder="Search ticket number or summary"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="zen-staff-queue__filters">
            <SelectField
              id="staff-queue-status"
              label="Status"
              value={status}
              onChange={handleStatusChange}
              placeholder="All Statuses"
              disabled={isLoading}
              options={STATUS_OPTIONS}
            />
            <SelectField
              id="staff-queue-it-priority"
              label="IT Priority"
              value={itPriority}
              onChange={handleItPriorityChange}
              placeholder="All Priorities"
              disabled={isLoading}
              options={IT_PRIORITY_OPTIONS}
            />
            <SelectField
              id="staff-queue-category"
              label="Category"
              value={categoryId}
              onChange={handleCategoryChange}
              placeholder="All Categories"
              disabled={isLoading}
              options={categoryOptions}
            />
            <SelectField
              id="staff-queue-owner"
              label="Owner"
              value={owner}
              onChange={handleOwnerChange}
              placeholder="Anyone"
              disabled={isLoading}
              options={OWNER_OPTIONS}
            />
            <SelectField
              id="staff-queue-sort"
              label="Sort"
              value={`${sort}-${direction}`}
              onChange={handleSortSelectChange}
              disabled={isLoading}
              options={SORT_OPTIONS}
            />
          </div>
        </div>
      )}

      {state.phase === "loading" && <QueueLoadingSkeleton />}

      {state.phase === "error" && <ErrorState message={state.message} onRetry={load} />}

      {state.phase === "loaded" && variant === "rows" && (
        <>
          <QueueTable
            items={state.items}
            sort={sort}
            direction={direction}
            onToggleSort={handleToggleSort}
            disabled={isLoading}
          />
          <Pagination
            page={state.page}
            pageSize={state.pageSize as PageSizeValue}
            totalItems={state.totalItems}
            totalPages={state.totalPages}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            disabled={isLoading}
          />
        </>
      )}

      {state.phase === "loaded" && variant === "empty" && (
        <EmptyState title="The queue is empty" />
      )}

      {state.phase === "loaded" && variant === "noResults" && (
        <NoResultsState
          message="No tickets match these filters"
          onClearFilters={handleClearFilters}
          clearFiltersLabel="Clear filters"
        />
      )}
    </AppShell>
  );
}
