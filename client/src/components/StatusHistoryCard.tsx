import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime } from "../tickets/formatDateTime";
import type { StatusChangeEntry } from "../tickets/workflowApi";
import "./StatusHistoryCard.css";

export interface StatusHistoryCardProps {
  history: StatusChangeEntry[] | "loading" | "error";
  /** Surface class of the host screen's card (staff or requester detail). */
  className: string;
  onRetry: () => void;
}

/**
 * Status history card (lab-04/ui-spec.md §5.3, §6): oldest first (BR-14),
 * each row "From → To · Name · date" with text badges. Read-only, so the
 * staff and Requester Ticket Details share it.
 */
export function StatusHistoryCard({
  history,
  className,
  onRetry,
}: StatusHistoryCardProps) {
  return (
    <section className={className} aria-labelledby="status-history-heading">
      <h2 id="status-history-heading">Status history</h2>
      {history === "loading" && <LoadingState label="Loading status history…" />}
      {history === "error" && (
        <ErrorState
          message="Status history could not be loaded."
          onRetry={onRetry}
        />
      )}
      {Array.isArray(history) && history.length === 0 && (
        <p>No status changes yet.</p>
      )}
      {Array.isArray(history) && history.length > 0 && (
        <ol className="zen-status-history">
          {history.map((entry) => (
            <li key={entry.id}>
              {entry.fromStatus && (
                <>
                  <StatusBadge value={entry.fromStatus} />{" "}
                </>
              )}
              <span aria-hidden="true">→</span>
              <span className="zen-status-history__sr-only"> to </span>{" "}
              <StatusBadge value={entry.toStatus} /> · {entry.changedBy.name} ·{" "}
              {formatDateTime(entry.changedAt)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
