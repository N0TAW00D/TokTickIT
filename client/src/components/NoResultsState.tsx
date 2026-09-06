import { Button } from "./Button";
import "./FeedbackStates.css";

export interface NoResultsStateProps {
  message?: string;
  /** Omit to hide the Clear Filters action. */
  onClearFilters?: () => void;
  clearFiltersLabel?: string;
}

/**
 * "Query matched nothing" block (ui-spec.md §5.4) — distinct from
 * EmptyState: filters stay visible/populated by the caller, and this
 * block offers a tertiary "Clear Filters" action instead of a primary CTA.
 */
export function NoResultsState({
  message = "No tickets match your filters",
  onClearFilters,
  clearFiltersLabel = "Clear Filters",
}: NoResultsStateProps) {
  return (
    <div className="zen-no-results">
      <div className="zen-no-results__icon" aria-hidden="true">
        🔍
      </div>
      <p className="zen-no-results__message">{message}</p>
      {onClearFilters && (
        <Button variant="tertiary" onClick={onClearFilters}>
          {clearFiltersLabel}
        </Button>
      )}
    </div>
  );
}
