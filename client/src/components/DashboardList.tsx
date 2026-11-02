import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "../dashboard/Dashboard.css";

export interface DashboardListProps {
  /** Band heading (an `h2`). */
  title: string;
  /** Full count behind the "View all (N)" link. */
  total: number;
  /** Drill-down list URL for the "View all" link. */
  viewAllTo: string;
  /** Plain-text message when there are no rows (lab-04 ui-spec.md §3.3). */
  emptyMessage: string;
  /** Row `<li>`s, at most 5 (BR-24). */
  children: ReactNode;
  isEmpty: boolean;
}

/**
 * A dashboard list band (lab-04 ui-spec.md §3.1/§4): `h2` + "View all (N)"
 * link, then a real `<ul>` of rows, or a plain-text empty message.
 */
export function DashboardList({
  title,
  total,
  viewAllTo,
  emptyMessage,
  children,
  isEmpty,
}: DashboardListProps) {
  return (
    <section className="zen-dashboard__list-band" aria-labelledby={headingId(title)}>
      <div className="zen-dashboard__list-header">
        <h2 id={headingId(title)} className="zen-dashboard__band-title">
          {title}
        </h2>
        <Link to={viewAllTo} className="zen-dashboard__view-all">
          View all ({total})
        </Link>
      </div>
      {isEmpty ? (
        <p className="zen-dashboard__empty">{emptyMessage}</p>
      ) : (
        <ul className="zen-dashboard__rows">{children}</ul>
      )}
    </section>
  );
}

function headingId(title: string): string {
  return `zen-dashboard-list-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
