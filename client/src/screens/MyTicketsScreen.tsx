import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { SelectField, type SelectOption } from "../components/SelectField";
import { TextInput } from "../components/TextInput";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { NoResultsState } from "../components/NoResultsState";
import { Pagination, type PageSizeValue } from "../components/Pagination";
import { PriorityBadge } from "../components/PriorityBadge";
import { StatusBadge } from "../components/StatusBadge";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useRequester } from "../requester/RequesterContext";
import {
  fetchCategories,
  fetchMyTickets,
  type ReferenceOption,
  type RequestedPriority,
  type SortOrder,
  type TicketListItem,
  type TicketListMeta,
  type TicketSortField,
} from "../tickets/api";
import { formatDateTime } from "../tickets/formatDateTime";
import "./MyTicketsScreen.css";

/** Table (`≥ 768px`) / card (`< 768px`) breakpoint (ui-spec.md §9, §11). */
const DESKTOP_QUERY = "(min-width: 768px)";

/** Search → `search` param debounce delay (ui-spec.md §9, AC-23). */
const SEARCH_DEBOUNCE_MS = 300;

type ListState =
  | { phase: "loading" }
  | { phase: "loaded"; items: TicketListItem[]; meta: TicketListMeta }
  | { phase: "error"; message: string };

/**
 * Which of the three "list came back empty" presentations (ui-spec.md §9
 * States table, BR-37) applies. All three share `items: []` from the API
 * (api-spec.md §3.2, AC-27) — this is derived from `meta` plus whether a
 * search/filter query is active, never from anything the caller can't see
 * in the response.
 *
 * - `empty`: the Requester owns zero tickets at all (`meta.totalItems`
 *   is 0 with no active query) — AC-29.
 * - `noResults`: an active search/filter matched nothing (`totalItems`
 *   is 0 *because* a query is active) — AC-30, BR-37.
 * - `overPage`: real tickets exist (`totalItems > 0`) but the requested
 *   page is past the last one, so this page's slice is empty — AC-27.
 */
type EmptyishVariant = "rows" | "empty" | "noResults" | "overPage";

function classifyList(
  items: TicketListItem[],
  meta: TicketListMeta,
  hasActiveQuery: boolean,
): EmptyishVariant {
  if (items.length > 0) return "rows";
  if (meta.totalItems === 0) return hasActiveQuery ? "noResults" : "empty";
  return "overPage";
}

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

// Status is a single-value enum in Lab 2 (specification.md A-05); the "All"
// placeholder plus this one option is the whole list until Lab 3 adds more.
const STATUS_OPTIONS: SelectOption[] = [{ value: "NEW", label: "New" }];

interface SortSelectOption extends SelectOption {
  sort: TicketSortField;
  order: SortOrder;
}

/** The six sort choices ui-spec.md §9 lists, in the order it lists them. */
const SORT_OPTIONS: SortSelectOption[] = [
  { value: "createdAt-desc", label: "Created (newest)", sort: "createdAt", order: "desc" },
  { value: "createdAt-asc", label: "Created (oldest)", sort: "createdAt", order: "asc" },
  { value: "updatedAt-desc", label: "Last updated (newest)", sort: "updatedAt", order: "desc" },
  { value: "updatedAt-asc", label: "Last updated (oldest)", sort: "updatedAt", order: "asc" },
  { value: "ticketNumber-asc", label: "Ticket number (A→Z)", sort: "ticketNumber", order: "asc" },
  { value: "ticketNumber-desc", label: "Ticket number (Z→A)", sort: "ticketNumber", order: "desc" },
];

const DEFAULT_SORT: TicketSortField = "createdAt";
const DEFAULT_ORDER: SortOrder = "desc";
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE: PageSizeValue = 10;

/** The order a column header's first click applies, per field (ui-spec.md §9). */
const HEADER_DEFAULT_ORDER: Record<TicketSortField, SortOrder> = {
  createdAt: "desc",
  updatedAt: "desc",
  ticketNumber: "asc",
};

const COLUMN_LABEL: Record<TicketSortField, string> = {
  ticketNumber: "Ticket No.",
  createdAt: "Created",
  updatedAt: "Last Updated",
};

/**
 * Accessible name for a sortable column header's toggle button (ui-spec.md
 * §12: "icon-only controls (e.g. sort carets) get an aria-label + title" —
 * the visual caret itself is pure CSS (`::after`, see MyTicketsScreen.css)
 * so it carries no text of its own; this string is what actually names the
 * control for assistive tech and the hover tooltip).
 */
function sortToggleLabel(
  field: TicketSortField,
  activeSort: TicketSortField,
  activeOrder: SortOrder,
): string {
  const label = COLUMN_LABEL[field];
  if (activeSort !== field) return `Sort by ${label}`;
  return activeOrder === "asc"
    ? `Sort by ${label}, ascending`
    : `Sort by ${label}, descending`;
}

/** `data-sort-state` driving the ⇅ / ▲ / ▼ CSS content (MyTicketsScreen.css). */
function sortState(
  field: TicketSortField,
  activeSort: TicketSortField,
  activeOrder: SortOrder,
): "none" | SortOrder {
  return activeSort === field ? activeOrder : "none";
}

interface TicketRowsProps {
  items: TicketListItem[];
}

interface SortableTableProps extends TicketRowsProps {
  sort: TicketSortField;
  order: SortOrder;
  onToggleSort: (field: TicketSortField) => void;
  disabled: boolean;
}

/**
 * One `<th>` for a sortable column (ui-spec.md §9: Ticket No., Created, and
 * Last Updated column headers "also toggle sort and show a ⇅ / ▲ / ▼
 * affordance"). The button's only text child is the plain column label —
 * the caret is added by CSS alone — so this never changes what `C-22`'s
 * header-text assertions read via `textContent`.
 */
function SortableHeader({
  field,
  sort,
  order,
  onToggleSort,
  disabled,
}: {
  field: TicketSortField;
  sort: TicketSortField;
  order: SortOrder;
  onToggleSort: (field: TicketSortField) => void;
  disabled: boolean;
}) {
  const label = sortToggleLabel(field, sort, order);
  return (
    <th scope="col">
      <button
        type="button"
        className="zen-my-tickets__sort-toggle"
        data-sort-state={sortState(field, sort, order)}
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

/**
 * Desktop table (ui-spec.md §9): exactly the eight columns the spec's
 * "Columns / card fields decision" lists — no attachment-count column
 * (that field is mobile-only).
 *
 * The whole row is a click target (§9's "whole row clickable + an
 * explicit View affordance") via the stretched-link pattern: the ticket
 * number's `zen-my-tickets__row-link` gets a `::after` stretched over the
 * row (MyTicketsScreen.css), rather than a row-level `onClick` — which
 * §12 would still require a real anchor underneath for keyboard/SR, so it
 * would add nothing but risk of nested interactive elements. This keeps
 * exactly two real links per row (the number and the explicit "View"),
 * never a third overlapping one.
 */
function TicketsTable({ items, sort, order, onToggleSort, disabled }: SortableTableProps) {
  return (
    <div className="zen-my-tickets__table-scroll">
      <table className="zen-my-tickets__table">
        <thead>
          <tr>
            <SortableHeader
              field="ticketNumber"
              sort={sort}
              order={order}
              onToggleSort={onToggleSort}
              disabled={disabled}
            />
            <SortableHeader
              field="createdAt"
              sort={sort}
              order={order}
              onToggleSort={onToggleSort}
              disabled={disabled}
            />
            <th scope="col">Summary</th>
            <th scope="col">Category</th>
            <th scope="col">Related System</th>
            <th scope="col">Priority</th>
            <th scope="col">Status</th>
            <SortableHeader
              field="updatedAt"
              sort={sort}
              order={order}
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
                  to={`/tickets/${ticket.id}`}
                  className="zen-my-tickets__row-link"
                >
                  {ticket.ticketNumber}
                </Link>
              </td>
              <td>{formatDateTime(ticket.createdAt)}</td>
              <td
                className="zen-my-tickets__truncate"
                title={ticket.summary}
              >
                {ticket.summary}
              </td>
              <td
                className="zen-my-tickets__truncate"
                title={ticket.category.name}
              >
                {ticket.category.name}
              </td>
              <td
                className="zen-my-tickets__truncate"
                title={ticket.relatedSystem.name}
              >
                {ticket.relatedSystem.name}
              </td>
              <td>
                <PriorityBadge value={ticket.requestedPriority} />
              </td>
              <td>
                <StatusBadge value={ticket.status} />
              </td>
              <td>{formatDateTime(ticket.updatedAt)}</td>
              <td>
                <Link
                  to={`/tickets/${ticket.id}`}
                  className="zen-my-tickets__view-link"
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
 * Mobile cards (ui-spec.md §9): the same fields as the desktop row, plus
 * the 📎 attachment count — the one field that is mobile-only — shown when
 * it is greater than zero. No FR-30 field is dropped at this viewport.
 *
 * The whole card is a click target via the same stretched-link pattern as
 * the desktop table (see TicketsTable above).
 */
function TicketsCards({ items }: TicketRowsProps) {
  return (
    <ul className="zen-my-tickets__cards">
      {items.map((ticket) => (
        <li key={ticket.id} className="zen-my-tickets__card">
          <div className="zen-my-tickets__card-header">
            <Link
              to={`/tickets/${ticket.id}`}
              className="zen-my-tickets__card-number zen-my-tickets__row-link"
            >
              {ticket.ticketNumber}
            </Link>
            <div className="zen-my-tickets__card-badges">
              <PriorityBadge value={ticket.requestedPriority} />
              <StatusBadge value={ticket.status} />
            </div>
          </div>

          <p
            className="zen-my-tickets__card-summary zen-my-tickets__truncate"
            title={ticket.summary}
          >
            {ticket.summary}
          </p>

          <p
            className="zen-my-tickets__card-classification zen-my-tickets__truncate"
            title={`${ticket.category.name} · ${ticket.relatedSystem.name}`}
          >
            {ticket.category.name} · {ticket.relatedSystem.name}
          </p>

          <p className="zen-my-tickets__card-timestamp">
            Created {formatDateTime(ticket.createdAt)}
          </p>

          <div className="zen-my-tickets__card-footer">
            <p className="zen-my-tickets__card-timestamp">
              Updated {formatDateTime(ticket.updatedAt)}
            </p>
            {ticket.activeAttachmentCount > 0 && (
              <span className="zen-my-tickets__card-attachments">
                📎 {ticket.activeAttachmentCount}
              </span>
            )}
          </div>

          <Link
            to={`/tickets/${ticket.id}`}
            className="zen-my-tickets__card-view zen-my-tickets__view-link"
          >
            {"View "}
            <span className="zen-visually-hidden">
              ticket {ticket.ticketNumber}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * My Tickets screen (ui-spec.md §9, `/tickets`) — data fetch, list
 * rendering, controls (search/filter/sort/clear), pagination, and every
 * loading/failure/empty-ish state (loading, failure, empty, no-results,
 * over-page).
 */
export function MyTicketsScreen() {
  const navigate = useNavigate();
  const { requesterId } = useRequester();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [state, setState] = useState<ListState>({ phase: "loading" });

  const [categories, setCategories] = useState<ReferenceOption[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<TicketSortField>(DEFAULT_SORT);
  const [order, setOrder] = useState<SortOrder>(DEFAULT_ORDER);
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [pageSize, setPageSize] = useState<PageSizeValue>(DEFAULT_PAGE_SIZE);

  const isLoading = state.phase === "loading";

  const isFiltersDefault =
    searchInput === "" &&
    categoryId === "" &&
    priority === "" &&
    status === "" &&
    sort === DEFAULT_SORT &&
    order === DEFAULT_ORDER;

  // Drives the empty vs. no-results split (BR-37): only a search/filter
  // counts as an active "query" here — sort and page never do, since
  // reordering or paging an otherwise-empty owner's list can't be what
  // produced zero results. debouncedSearch is trimmed before the check so
  // a whitespace-only search — which api.ts already drops rather than
  // sending as a `search` param (BR-16) — counts as inactive here too,
  // matching what the server actually saw.
  const hasActiveQuery =
    debouncedSearch.trim() !== "" ||
    categoryId !== "" ||
    priority !== "" ||
    status !== "";

  // Reference data for the Category filter (ui-spec.md §9, `GET
  // /api/categories`) — not Requester-scoped, loaded once. A failure here
  // simply leaves the Category filter at "All Categories only"; this
  // slice doesn't add a dedicated error UI for it (out of the controls
  // scope, and not something tests.md's C-23 exercises).
  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  // The last search value the debounce actually *committed*, normalized
  // the same way hasActiveQuery/BR-16 treat "active" (trimmed). Seeded
  // from the initial searchInput so this effect's mount-time run — it
  // fires once on mount just like any other effect, with the search box
  // still empty — reads as "unchanged" rather than a change into "".
  const previousSearchRef = useRef(searchInput.trim());

  // Debounce the search box 300ms before it drives the `search` param
  // (ui-spec.md §9, AC-23): every keystroke restarts this timer, so only
  // the value that has stood still for the full delay is ever applied.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      const normalizedSearch = searchInput.trim();
      // Reset the page only when the search term actually changed.
      // Without this guard, the mount-time run above (searchInput is
      // still "" then) would unconditionally bounce an already-paginated
      // user back to page 1 moments after mount. A genuine change, on
      // the other hand, can move the current page past the new result
      // count (or simply mean something different at "page 3") — so that
      // case still lands back on page 1 rather than risk stranding the
      // user on an over-page/no-results state a fresh page 1 wouldn't
      // have shown.
      if (normalizedSearch !== previousSearchRef.current) {
        setPage(DEFAULT_PAGE);
      }
      previousSearchRef.current = normalizedSearch;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(() => {
    // RequireRequester guarantees a valid requesterId by the time this
    // screen renders; this is a type-narrowing guard, not a real branch.
    if (requesterId === null) return;

    setState({ phase: "loading" });
    fetchMyTickets(requesterId, {
      search: debouncedSearch,
      categoryId: categoryId ? Number(categoryId) : undefined,
      priority: priority ? (priority as RequestedPriority) : undefined,
      status: status || undefined,
      sort,
      order,
      page,
      pageSize,
    })
      .then((response) => {
        setState({ phase: "loaded", items: response.items, meta: response.meta });
      })
      .catch(() => {
        setState({
          phase: "error",
          message:
            "Could not load your tickets. Please check your connection and try again.",
        });
      });
  }, [
    requesterId,
    debouncedSearch,
    categoryId,
    priority,
    status,
    sort,
    order,
    page,
    pageSize,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  // Every handler below that changes search/filters/sort/page-size also
  // resets to page 1 in the same call — not via a separate "watch for
  // change, then reset" effect. Reacting to a filter change with a fetch
  // fired against the *old* page before a follow-up effect corrects it
  // would flash a wrong request (or a stray "no more tickets" message)
  // between the two; batching both state updates into one handler means
  // `load` only ever sees the two changes together, as a single request.

  function handleToggleSort(field: TicketSortField) {
    if (sort === field) {
      setOrder((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(field);
      setOrder(HEADER_DEFAULT_ORDER[field]);
    }
    setPage(DEFAULT_PAGE);
  }

  function handleSortSelectChange(value: string) {
    const option = SORT_OPTIONS.find((candidate) => candidate.value === value);
    if (!option) return;
    setSort(option.sort);
    setOrder(option.order);
    setPage(DEFAULT_PAGE);
  }

  function handleCategoryChange(value: string) {
    setCategoryId(value);
    setPage(DEFAULT_PAGE);
  }

  function handlePriorityChange(value: string) {
    setPriority(value);
    setPage(DEFAULT_PAGE);
  }

  function handleStatusChange(value: string) {
    setStatus(value);
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
    setCategoryId("");
    setPriority("");
    setStatus("");
    setSort(DEFAULT_SORT);
    setOrder(DEFAULT_ORDER);
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

  // Only meaningful once loaded — classifyList always returns "rows" for
  // the loading/error phases' placeholder meta, which nothing below reads
  // in those phases anyway.
  const variant: EmptyishVariant =
    state.phase === "loaded"
      ? classifyList(state.items, state.meta, hasActiveQuery)
      : "rows";

  // ui-spec.md §9 AC-29: the true-empty state ("Requester owns zero
  // tickets") hides the search/filter/sort bar entirely — there is
  // nothing to search or filter yet. The no-results and over-page states
  // (both reached only once a query is active or a page requested) keep
  // it visible and populated on purpose (AC-30, BR-37) so the user can see
  // and undo what produced the empty slice.
  const hideControls = variant === "empty";

  return (
    <AppShell>
      <div className="zen-my-tickets__header">
        <div>
          <h1>My Tickets</h1>
          <p className="zen-my-tickets__intro">
            View and track all of your support requests.
          </p>
        </div>
        <div className="zen-my-tickets__header-actions">
          {!isFiltersDefault && (
            <Button
              variant="tertiary"
              onClick={handleClearFilters}
              disabled={isLoading}
            >
              Clear filters
            </Button>
          )}
          <Button variant="primary" onClick={() => navigate("/tickets/new")}>
            + Create Ticket
          </Button>
        </div>
      </div>

      {!hideControls && (
        <div className="zen-my-tickets__controls">
          <div className="zen-my-tickets__search-field">
            <label htmlFor="my-tickets-search" className="zen-visually-hidden">
              Search
            </label>
            <TextInput
              id="my-tickets-search"
              type="search"
              placeholder="Search by ticket number or summary"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="zen-my-tickets__filters">
            <SelectField
              id="my-tickets-category"
              label="Category"
              value={categoryId}
              onChange={handleCategoryChange}
              placeholder="All Categories"
              disabled={isLoading}
              options={categoryOptions}
            />
            <SelectField
              id="my-tickets-priority"
              label="Priority"
              value={priority}
              onChange={handlePriorityChange}
              placeholder="All Priorities"
              disabled={isLoading}
              options={PRIORITY_OPTIONS}
            />
            <SelectField
              id="my-tickets-status"
              label="Status"
              value={status}
              onChange={handleStatusChange}
              placeholder="All Statuses"
              disabled={isLoading}
              options={STATUS_OPTIONS}
            />
            <SelectField
              id="my-tickets-sort"
              label="Sort"
              value={`${sort}-${order}`}
              onChange={handleSortSelectChange}
              disabled={isLoading}
              options={SORT_OPTIONS}
            />
          </div>
        </div>
      )}

      {state.phase === "loading" && (
        <LoadingState label="Loading your tickets…" />
      )}

      {state.phase === "error" && (
        <ErrorState message={state.message} onRetry={load} />
      )}

      {state.phase === "loaded" && variant === "rows" && (
        <>
          {isDesktop ? (
            <TicketsTable
              items={state.items}
              sort={sort}
              order={order}
              onToggleSort={handleToggleSort}
              disabled={isLoading}
            />
          ) : (
            <TicketsCards items={state.items} />
          )}
          <Pagination
            page={state.meta.page}
            pageSize={state.meta.pageSize}
            totalItems={state.meta.totalItems}
            totalPages={state.meta.totalPages}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            disabled={isLoading}
          />
        </>
      )}

      {/* AC-29, BR-37: the Requester owns zero tickets at all — distinct
          from a query matching nothing, and the controls bar above is
          hidden rather than shown empty. */}
      {state.phase === "loaded" && variant === "empty" && (
        <EmptyState
          title="You haven't created any tickets yet."
          action={
            <Button variant="primary" onClick={() => navigate("/tickets/new")}>
              + Create your first ticket
            </Button>
          }
        />
      )}

      {/* AC-30, BR-37: an active search/filter matched nothing. The
          controls bar above stays visible and populated (not hidden or
          reset) so the user can see and undo what they typed. */}
      {state.phase === "loaded" && variant === "noResults" && (
        <NoResultsState
          message="No tickets match your search or filters."
          onClearFilters={handleClearFilters}
          clearFiltersLabel="Clear filters"
        />
      )}

      {/* AC-27: the API returned 200 with items: [] because the requested
          page is past the last one for this query, not because the query
          itself failed or matched nothing — meta.totalItems is still > 0. */}
      {state.phase === "loaded" && variant === "overPage" && (
        <NoResultsState
          message="No more tickets on this page."
          onClearFilters={() => setPage(DEFAULT_PAGE)}
          clearFiltersLabel="Back to page 1"
        />
      )}
    </AppShell>
  );
}
