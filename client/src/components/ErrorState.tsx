import { Button } from "./Button";
import "./FeedbackStates.css";

export interface ErrorStateProps {
  message: string;
  /** Omit to hide the Retry action. */
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Failure block (ui-spec.md §5.4): assertive role="alert" callout on
 * --zen-error-bg with a secondary Retry button.
 */
export function ErrorState({ message, onRetry, retryLabel = "Retry" }: ErrorStateProps) {
  return (
    <div className="zen-error-state" role="alert">
      <p className="zen-error-state__message">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
