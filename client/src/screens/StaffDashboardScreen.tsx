import { Link } from "react-router-dom";
import { MetricCard, ZERO_SUB_LABEL } from "../components/MetricCard";
import { DashboardList } from "../components/DashboardList";
import { OwnerCell } from "../components/OwnerCell";
import { PriorityBadge } from "../components/PriorityBadge";
import { StatusBadge, getStatusLabel } from "../components/StatusBadge";
import { DashboardFrame } from "../dashboard/DashboardFrame";
import { useDashboard } from "../dashboard/useDashboard";
import {
  fetchStaffDashboard,
  type DashboardOpenAction,
  type StaffDashboardResponse,
  type StaffDashboardTicket,
} from "../dashboard/api";
import type { Role } from "../auth/api";
import type { ItPriority, StaffQueueStatus } from "../staff/api";
import { formatDateTime } from "../tickets/formatDateTime";

/** Eight statuses in lifecycle order — the key order of `byStatus` is not relied on. */
const STATUS_ORDER: StaffQueueStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
];

const PRIORITY_ORDER: { value: ItPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

const USER_ROLE_LABEL: Record<Role, string> = {
  REQUESTER: "Requesters",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrators",
};

const ACTION_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
};

/** Drill-down URLs (api-spec.md §5). */
const LINKS = {
  unassigned: "/staff/tickets?owner=unassigned&scope=open",
  ownedByMe: "/staff/tickets?owner=me&scope=open",
  urgent: "/staff/tickets?itPriority=HIGH&scope=open",
  followUps: "/staff/tickets?followUp=true&scope=open",
  myActions: "/staff/tickets?myActions=true&scope=open",
  recent: "/staff/tickets?scope=recent&sort=updatedAt&direction=desc",
  status: (status: StaffQueueStatus) => `/staff/tickets?status=${status}`,
  priority: (priority: ItPriority) => `/staff/tickets?itPriority=${priority}&scope=open`,
  users: (role: Role) => `/admin/users?role=${role}`,
};

/** Sub-label + attention flag for one card: zero is calm, non-zero may need attention in words. */
function cardCopy(value: number, description: string, attentionText?: string) {
  if (value === 0) return { subLabel: ZERO_SUB_LABEL, attention: false };
  if (attentionText) return { subLabel: attentionText, attention: true };
  return { subLabel: description, attention: false };
}

function TicketRow({ ticket }: { ticket: StaffDashboardTicket }) {
  return (
    <li className="zen-dashboard__row">
      <Link to={`/staff/tickets/${ticket.id}`} className="zen-dashboard__row-link">
        {ticket.ticketNumber}
      </Link>
      <span className="zen-dashboard__row-summary" title={ticket.summary}>
        {ticket.summary}
      </span>
      <span className="zen-dashboard__row-meta">
        <StatusBadge value={ticket.status} />
        <PriorityBadge value={ticket.itPriority} variant="it" />
        <OwnerCell owner={ticket.owner} />
        <span>{formatDateTime(ticket.updatedAt)}</span>
      </span>
    </li>
  );
}

function ActionRow({ action }: { action: DashboardOpenAction }) {
  return (
    <li className="zen-dashboard__row">
      <span className="zen-dashboard__row-meta">{formatDateTime(action.actionAt)}</span>
      <span className="zen-dashboard__row-summary" title={action.description}>
        {action.description}
      </span>
      <span className="zen-dashboard__action-status">
        {ACTION_STATUS_LABEL[action.status] ?? action.status}
      </span>
      <Link to={`/staff/tickets/${action.ticketId}`} className="zen-dashboard__row-link">
        {action.ticketNumber}
      </Link>
    </li>
  );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function StaffDashboardBody({ data }: { data: StaffDashboardResponse }) {
  const { metrics, myOpenActions } = data;
  const unassigned = cardCopy(metrics.unassigned, "Open tickets with no owner", "Needs an owner");
  const owned = cardCopy(metrics.ownedByMe, "Open tickets you own");
  const urgent = cardCopy(metrics.urgent, "High IT priority, still open", "High IT priority, needs attention");
  const followUps = cardCopy(metrics.followUpsRequired, "Tickets with a follow-up", "Needs follow-up");
  const actionsSub =
    myOpenActions.actions === 0
      ? ZERO_SUB_LABEL
      : `on ${myOpenActions.tickets} ${plural(myOpenActions.tickets, "ticket", "tickets")}`;

  return (
    <>
      <section className="zen-dashboard__band" aria-labelledby="zen-dashboard-work-queue">
        <h2 id="zen-dashboard-work-queue" className="zen-dashboard__band-title">
          Work queue
        </h2>
        <div className="zen-dashboard__metrics zen-dashboard__metrics--4">
          <MetricCard label="Unassigned" value={metrics.unassigned} to={LINKS.unassigned} {...unassigned} />
          <MetricCard label="Owned by Me" value={metrics.ownedByMe} to={LINKS.ownedByMe} {...owned} />
          <MetricCard label="Urgent" value={metrics.urgent} to={LINKS.urgent} {...urgent} />
          <MetricCard
            label="Follow-ups Required"
            value={metrics.followUpsRequired}
            to={LINKS.followUps}
            {...followUps}
          />
        </div>
      </section>

      <section className="zen-dashboard__band" aria-labelledby="zen-dashboard-my-actions">
        <h2 id="zen-dashboard-my-actions" className="zen-visually-hidden">
          Your open actions
        </h2>
        <div className="zen-dashboard__metrics">
          <MetricCard
            label="My Open Actions"
            value={myOpenActions.actions}
            to={LINKS.myActions}
            subLabel={actionsSub}
          />
        </div>
        {myOpenActions.items.length === 0 ? (
          <p className="zen-dashboard__empty">You have no open actions.</p>
        ) : (
          <ul className="zen-dashboard__rows zen-dashboard__actions-rows">
            {myOpenActions.items.map((action) => (
              <ActionRow key={action.id} action={action} />
            ))}
          </ul>
        )}
      </section>

      <section className="zen-dashboard__band" aria-labelledby="zen-dashboard-by-status">
        <h2 id="zen-dashboard-by-status" className="zen-dashboard__band-title">
          Tickets by status
        </h2>
        <ul className="zen-dashboard__counts zen-dashboard__counts--status">
          {STATUS_ORDER.map((status) => (
            <li key={status}>
              <Link
                to={LINKS.status(status)}
                className="zen-dashboard__count-link"
                aria-label={`${getStatusLabel(status)}: ${data.byStatus[status] ?? 0}, view list`}
              >
                <StatusBadge value={status} />
                <span className="zen-dashboard__count-value">{data.byStatus[status] ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="zen-dashboard__band" aria-labelledby="zen-dashboard-by-priority">
        <h2 id="zen-dashboard-by-priority" className="zen-dashboard__band-title">
          Open by IT priority
        </h2>
        <ul className="zen-dashboard__counts zen-dashboard__counts--priority">
          {PRIORITY_ORDER.map(({ value, label }) => (
            <li key={value}>
              <Link
                to={LINKS.priority(value)}
                className="zen-dashboard__count-link"
                aria-label={`IT Priority ${label}: ${data.byItPriority[value] ?? 0}, view list`}
              >
                <PriorityBadge value={value} variant="it" />
                <span className="zen-dashboard__count-value">{data.byItPriority[value] ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="zen-dashboard__lists">
        <DashboardList
          title="Urgent Tickets"
          total={data.urgentTickets.total}
          viewAllTo={LINKS.urgent}
          emptyMessage="No urgent tickets."
          isEmpty={data.urgentTickets.items.length === 0}
        >
          {data.urgentTickets.items.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} />
          ))}
        </DashboardList>
        <DashboardList
          title="Recently Updated"
          total={data.recentlyUpdated.total}
          viewAllTo={LINKS.recent}
          emptyMessage="No tickets updated in the last 7 days."
          isEmpty={data.recentlyUpdated.items.length === 0}
        >
          {data.recentlyUpdated.items.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} />
          ))}
        </DashboardList>
      </div>

      {data.userCounts && (
        <section className="zen-dashboard__band" aria-labelledby="zen-dashboard-users">
          <h2 id="zen-dashboard-users" className="zen-dashboard__band-title">
            Users
          </h2>
          <div className="zen-dashboard__metrics zen-dashboard__metrics--3">
            {data.userCounts.map((entry) => (
              <MetricCard
                key={entry.role}
                label={USER_ROLE_LABEL[entry.role]}
                value={entry.active + entry.inactive}
                to={LINKS.users(entry.role)}
                subLabel={`${entry.active} active · ${entry.inactive} inactive`}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/**
 * IT Staff Dashboard (`/dashboard`, IT Staff and Administrator — lab-04
 * ui-spec.md §3). An Administrator additionally gets the Users strip because
 * the API only sends `userCounts` to them (BR-32).
 */
export function StaffDashboardScreen() {
  const { state, retry, refresh } = useDashboard(fetchStaffDashboard);
  return (
    <DashboardFrame state={state} onRetry={retry} onRefresh={refresh}>
      {(data) => <StaffDashboardBody data={data} />}
    </DashboardFrame>
  );
}
