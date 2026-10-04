import { useEffect, useRef } from "react";
import { Button } from "./Button";
import "./ConfirmStatusChangeDialog.css";

/** Focusable elements inside the dialog, in DOM order, for the Tab trap. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('button:not([disabled])'),
  );
}

export interface ConfirmStatusChangeDialogProps {
  /** Dialog heading, e.g. "Close this ticket?" */
  title: string;
  /** Explanatory body copy shown beneath the heading. */
  body: string;
  /** Label for the primary (destructive/confirming) action button. */
  confirmLabel: string;
  /** True while the confirm request is in flight — disables both buttons and shows `busy` on Confirm. */
  busy: boolean;
  /** A failure from the last submit attempt (not the 409 conflict, which closes this dialog and shows the page-level banner instead). */
  errorMessage?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Generic status-change confirmation dialog (ui-spec.md §10: "Close, Reopen
 * and Cancel open a confirm dialog first"). Same modal shell as
 * `ConfirmResolvedDialog` — role="dialog", `aria-modal`, Esc + a Cancel
 * button to dismiss, a Tab focus trap — but with `title`/`body`/
 * `confirmLabel` as props instead of hardcoded copy, since this one dialog
 * expresses three different confirmations (Close/Reopen/Cancel) rather than
 * `ConfirmResolvedDialog`'s single "Problem appears resolved?" case.
 */
export function ConfirmStatusChangeDialog({
  title,
  body,
  confirmLabel,
  busy,
  errorMessage,
  onCancel,
  onConfirm,
}: ConfirmStatusChangeDialogProps) {
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
    <div className="zen-confirm-status__overlay">
      <div
        ref={dialogRef}
        className="zen-confirm-status"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zen-confirm-status-title"
      >
        <h2 id="zen-confirm-status-title">{title}</h2>
        <p className="zen-confirm-status__body">{body}</p>

        {errorMessage && (
          <div role="alert" className="zen-confirm-status__error">
            {errorMessage}
          </div>
        )}

        <div className="zen-confirm-status__actions">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" variant="primary" busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
