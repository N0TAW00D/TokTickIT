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
 *
 * Color is never the sole signal (ui-spec.md §12): the message is paired
 * with a ⚠ glyph. The glyph is `aria-hidden` since the surrounding
 * `role="alert"` region already announces the message text — a screen
 * reader should not additionally read the symbol name as content.
 */
export function ErrorState({ message, onRetry, retryLabel = "Retry" }: ErrorStateProps) {
  return (
    <div className="zen-error-state" role="alert">
      <p className="zen-error-state__message">
        <span className="zen-error-state__icon" aria-hidden="true">
          ⚠
        </span>{" "}
        {message}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
