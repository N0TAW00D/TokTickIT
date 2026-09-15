import { useEffect, useRef } from "react";
import { Button } from "./Button";
import "./ConfirmResolvedDialog.css";

/** Focusable elements inside the dialog, in DOM order, for the Tab trap. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('button:not([disabled])'),
  );
}

export interface ConfirmResolvedDialogProps {
  /** True while the confirm request is in flight — disables both buttons and shows `busy` on Confirm. */
  busy: boolean;
  /** A failure from the last submit attempt (not the 409 conflict, which closes this dialog and shows the page-level banner instead). */
  errorMessage?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * "Problem Appears Resolved" confirmation dialog (ui-spec.md §7). Same
 * modal shell as `RemoveAttachmentDialog` — role="dialog", `aria-modal`,
 * Esc + a Cancel button to dismiss, a Tab focus trap — but with no form
 * field: this action carries no input, just a confirmation.
 */
export function ConfirmResolvedDialog({
  busy,
  errorMessage,
  onCancel,
  onConfirm,
}: ConfirmResolvedDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (busy) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = getFocusable(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="zen-confirm-resolved__overlay">
      <div
        ref={dialogRef}
        className="zen-confirm-resolved"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zen-confirm-resolved-title"
      >
        <h2 id="zen-confirm-resolved-title">Problem appears resolved?</h2>
        <p className="zen-confirm-resolved__body">
          Let IT Staff know this looks resolved? They'll confirm before the
          ticket is closed.
        </p>

        {errorMessage && (
          <div role="alert" className="zen-confirm-resolved__error">
            {errorMessage}
          </div>
        )}

        <div className="zen-confirm-resolved__actions">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" variant="primary" busy={busy} onClick={onConfirm}>
            Yes, let IT Staff know
          </Button>
        </div>
      </div>
    </div>
  );
}
