import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./Button";
import { FormField } from "./FormField";
import { TextArea } from "./TextArea";
import "./RemoveAttachmentDialog.css";

/** Trimmed-length bounds for the removal reason (specification.md A-09, BR-31; api-spec.md §4.4). */
const REASON_MIN = 3;
const REASON_MAX = 200;

/**
 * Trimmed-length validation matching the server's rule exactly
 * (server/src/validation/attachmentRemoval.ts) — run here so an invalid
 * reason never reaches the network at all (tests.md C-19: "no DELETE
 * fired").
 */
function validateReason(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
    return `Reason for removal must be between ${REASON_MIN} and ${REASON_MAX} characters.`;
  }
  return undefined;
}

/** Focusable elements inside the dialog, in DOM order, for the Tab trap. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export interface RemoveAttachmentDialogProps {
  /** The attachment's file name, shown in the dialog body (ui-spec.md §10: "body names the file"). */
  fileName: string;
  /** True while the confirm request is in flight — disables both buttons and shows `busy` on Remove. */
  busy: boolean;
  /**
   * A non-field error from the last submit attempt (e.g. `409
   * ALREADY_REMOVED`) — shown as its own alert, distinct from the
   * reason field's error, and does not close the dialog.
   */
  conflictError?: string;
  /**
   * A field-level error surfaced by the server on the last submit
   * attempt (a `400 VALIDATION_FAILED` response) — defence in depth
   * alongside the client-side `validateReason` check above, since the
   * two are expected to agree.
   */
  serverFieldError?: string;
  onCancel: () => void;
  /** Called with the trimmed reason once client-side validation passes. */
  onConfirm: (reason: string) => void;
}

/**
 * Remove-attachment confirmation dialog (ui-spec.md §10 "Remove flow",
 * tests.md C-18/C-19). Purely a modal shell + the required-reason form —
 * it never calls the API itself; `AttachmentSection` owns the actual
 * `removeAttachment` request and this component's `busy`/error props.
 */
export function RemoveAttachmentDialog({
  fileName,
  busy,
  conflictError,
  serverFieldError,
  onCancel,
  onConfirm,
}: RemoveAttachmentDialogProps) {
  const [reason, setReason] = useState("");
  const [localFieldError, setLocalFieldError] = useState<string | undefined>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Initial focus lands in the dialog (ui-spec.md §10: "focus trapped in
  // the dialog"), on the one required field.
  useEffect(() => {
    textAreaRef.current?.focus();
  }, []);

  // Esc cancels; Tab/Shift+Tab wrap within the dialog's focusable elements
  // instead of escaping to the page behind it (ui-spec.md §10).
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

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateReason(reason);
    if (error) {
      setLocalFieldError(error);
      return;
    }
    setLocalFieldError(undefined);
    onConfirm(reason.trim());
  }

  const fieldError = localFieldError ?? serverFieldError;

  return (
    <div className="zen-remove-dialog__overlay">
      <div
        ref={dialogRef}
        className="zen-remove-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zen-remove-dialog-title"
      >
        <h2 id="zen-remove-dialog-title">Remove attachment</h2>
        <p className="zen-remove-dialog__body">
          Remove <strong>{fileName}</strong>? It will no longer be available
          for download or preview.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <FormField
            id="remove-attachment-reason"
            label="Reason for removal"
            required
            error={fieldError}
            counter={{ current: reason.length, max: REASON_MAX }}
          >
            <TextArea
              ref={textAreaRef}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>

          {conflictError && (
            <div role="alert" className="zen-remove-dialog__conflict">
              {conflictError}
            </div>
          )}

          <div className="zen-remove-dialog__actions">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" busy={busy}>
              Remove attachment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
