import { Link } from "react-router-dom";
import { MetricCard } from "../components/MetricCard";
import { DashboardList } from "../components/DashboardList";
import { StatusBadge } from "../components/StatusBadge";
import { DashboardFrame } from "../dashboard/DashboardFrame";
import { useDashboard } from "../dashboard/useDashboard";
import {
  fetchRequesterDashboard,
  type RequesterDashboardResponse,
  type RequesterDashboardTicket,
} from "../dashboard/api";
import { formatDateTime } from "../tickets/formatDateTime";

/** Drill-down URLs (api-spec.md §4). */
const LINKS = {
  open: "/tickets?scope=open",
  waiting: "/tickets?status=WAITING_FOR_REQUESTER",
  recent: "/tickets?scope=recent&sort=updatedAt&order=desc",
  resolved: "/tickets?scope=recently-resolved",
};

function TicketRow({ ticket, at }: { ticket: RequesterDashboardTicket; at: string }) {
  return (
    <li className="zen-dashboard__row">
      <Link to={`/tickets/${ticket.id}`} className="zen-dashboard__row-link">
        {ticket.ticketNumber}
      </Link>
      <span className="zen-dashboard__row-summary" title={ticket.summary}>
        {ticket.summary}
      </span>
      <span className="zen-dashboard__row-meta">
        <StatusBadge value={ticket.status} />
        <span>{formatDateTime(at)}</span>
      </span>
    </li>
  );
}

function RequesterDashboardBody({ data }: { data: RequesterDashboardResponse }) {
  const { openTickets, waitingForMe } = data.metrics;
  return (
    <>
      <section className="zen-dashboard__band" aria-labelledby="zen-dashboard-requester-cards">
        <h2 id="zen-dashboard-requester-cards" className="zen-visually-hidden">
          Your tickets
        </h2>
        <div className="zen-dashboard__metrics">
          <MetricCard
            label="Open Tickets"
            value={openTickets}
            to={LINKS.open}
            subLabel={openTickets === 0 ? "You have no open tickets." : "Not yet resolved or closed"}
          />
          <MetricCard
            label="Waiting for Me"
            value={waitingForMe}
            to={LINKS.waiting}
            subLabel={waitingForMe === 0 ? "Nothing is waiting for you." : "IT Staff are waiting for your reply"}
            attention={waitingForMe > 0}
          />
        </div>
      </section>

      <div className="zen-dashboard__lists">
        <DashboardList
          title="Recently Updated"
          total={data.recentlyUpdated.total}
          viewAllTo={LINKS.recent}
          emptyMessage="No tickets updated in the last 7 days."
          isEmpty={data.recentlyUpdated.items.length === 0}
        >
          {data.recentlyUpdated.items.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} at={ticket.updatedAt} />
          ))}
        </DashboardList>
        <DashboardList
          title="Recently Resolved"
          total={data.recentlyResolved.total}
          viewAllTo={LINKS.resolved}
          emptyMessage="No tickets resolved in the last 7 days."
          isEmpty={data.recentlyResolved.items.length === 0}
        >
          {data.recentlyResolved.items.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} at={ticket.resolvedAt ?? ticket.updatedAt} />
          ))}
        </DashboardList>
      </div>
    </>
  );
}

/**
 * Requester Dashboard (`/dashboard`, Requester — lab-04 ui-spec.md §4):
 * summarises only the caller's own tickets and links into My Tickets.
 */
export function RequesterDashboardScreen() {
  const { state, retry, refresh } = useDashboard(fetchRequesterDashboard);
  return (
    <DashboardFrame state={state} onRetry={retry} onRefresh={refresh}>
      {(data) => <RequesterDashboardBody data={data} />}
    </DashboardFrame>
  );
}
