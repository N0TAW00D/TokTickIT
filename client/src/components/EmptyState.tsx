import type { ReactNode } from "react";
import "./FeedbackStates.css";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Primary call-to-action, e.g. a `<Button variant="primary">`. */
  action?: ReactNode;
}

/**
 * "No data yet" block (ui-spec.md §5.4): icon + headline + one-line
 * explanation + primary CTA. Distinct in structure and tone from
 * NoResultsState, which covers a query that matched nothing.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="zen-empty-state">
      {icon && (
        <div className="zen-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className="zen-empty-state__title">{title}</h2>
      {description && (
        <p className="zen-empty-state__description">{description}</p>
      )}
      {action && <div className="zen-empty-state__action">{action}</div>}
    </div>
  );
}
