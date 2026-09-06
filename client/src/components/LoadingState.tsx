import "./FeedbackStates.css";

export interface LoadingStateProps {
  label?: string;
}

/** Polite loading indicator (ui-spec.md §5.4): role="status", spinner + text. */
export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <div className="zen-loading" role="status">
      <span className="zen-loading__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
