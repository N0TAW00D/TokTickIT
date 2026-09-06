import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../shell/AppShell";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { PriorityBadge } from "../components/PriorityBadge";
import { StatusBadge } from "../components/StatusBadge";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useRequester } from "../requester/RequesterContext";
import { fetchMyTickets, type TicketListItem } from "../tickets/api";
import { formatDateTime } from "../tickets/formatDateTime";
import "./MyTicketsScreen.css";

/** Table (`≥ 768px`) / card (`< 768px`) breakpoint (ui-spec.md §9, §11). */
const DESKTOP_QUERY = "(min-width: 768px)";

type ListState =
  | { phase: "loading" }
  | { phase: "loaded"; items: TicketListItem[] }
  | { phase: "error"; message: string };

interface TicketRowsProps {
  items: TicketListItem[];
}

/**
 * Desktop table (ui-spec.md §9): exactly the eight columns the spec's
 * "Columns / card fields decision" lists — no attachment-count column
 * (that field is mobile-only).
 */
function TicketsTable({ items }: TicketRowsProps) {
  return (
    <div className="zen-my-tickets__table-scroll">
      <table className="zen-my-tickets__table">
        <thead>
          <tr>
            <th scope="col">Ticket No.</th>
            <th scope="col">Created</th>
            <th scope="col">Summary</th>
            <th scope="col">Category</th>
            <th scope="col">Related System</th>
            <th scope="col">Priority</th>
            <th scope="col">Status</th>
            <th scope="col">Last Updated</th>
            <th scope="col">
              <span className="zen-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <Link to={`/tickets/${ticket.id}`}>{ticket.ticketNumber}</Link>
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
                <Link to={`/tickets/${ticket.id}`}>
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
 */
function TicketsCards({ items }: TicketRowsProps) {
  return (
    <ul className="zen-my-tickets__cards">
      {items.map((ticket) => (
        <li key={ticket.id} className="zen-my-tickets__card">
          <div className="zen-my-tickets__card-header">
            <Link
              to={`/tickets/${ticket.id}`}
              className="zen-my-tickets__card-number"
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
            className="zen-my-tickets__card-view"
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
 * rendering, and loading/failure states only (Issue #18 part 1).
 * Search/filter/sort/pagination and the empty / no-results / over-page
 * states belong to the next slice.
 */
export function MyTicketsScreen() {
  const { requesterId } = useRequester();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [state, setState] = useState<ListState>({ phase: "loading" });

  const load = useCallback(() => {
    // RequireRequester guarantees a valid requesterId by the time this
    // screen renders; this is a type-narrowing guard, not a real branch.
    if (requesterId === null) return;

    setState({ phase: "loading" });
    fetchMyTickets(requesterId)
      .then((response) => {
        setState({ phase: "loaded", items: response.items });
      })
      .catch(() => {
        setState({
          phase: "error",
          message:
            "Could not load your tickets. Please check your connection and try again.",
        });
      });
  }, [requesterId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell>
      <h1>My Tickets</h1>
      <p className="zen-my-tickets__intro">
        View and track all of your support requests.
      </p>

      {state.phase === "loading" && (
        <LoadingState label="Loading your tickets…" />
      )}

      {state.phase === "error" && (
        <ErrorState message={state.message} onRetry={load} />
      )}

      {state.phase === "loaded" &&
        (isDesktop ? (
          <TicketsTable items={state.items} />
        ) : (
          <TicketsCards items={state.items} />
        ))}
    </AppShell>
  );
}
