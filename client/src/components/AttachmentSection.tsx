import { useRef, useState } from "react";
import { AttachmentList } from "./AttachmentList";
import { RemoveAttachmentDialog } from "./RemoveAttachmentDialog";
import {
  removeAttachment,
  RemoveAttachmentError,
  type TicketAttachment,
} from "../tickets/api";
import "./AttachmentSection.css";

/** The Remove dialog currently open, and any outcome from its last submit attempt. */
interface DialogState {
  attachment: TicketAttachment;
  busy: boolean;
  /** A `409 ALREADY_REMOVED` message — not a field error (api-spec.md §4.4). */
  conflictError?: string;
  /** A `400 VALIDATION_FAILED` field message, kept alongside the dialog's own client-side check. */
  serverFieldError?: string;
}

export interface AttachmentSectionProps {
  attachments: TicketAttachment[];
  requesterId: number;
  /**
   * Called with the server's updated attachment metadata (`isRemoved:
   * true`, `removedAt`, `removedReason`) once a removal succeeds — the
   * caller is expected to replace that attachment in its own ticket state
   * so the row and the "N active / M total" heading both update.
   */
  onAttachmentRemoved: (updated: TicketAttachment) => void;
  onDownload?: (attachment: TicketAttachment) => void;
  onPreview?: (attachment: TicketAttachment) => void;
}

/**
 * Wraps the presentational `AttachmentList` with the Remove confirmation
 * flow (ui-spec.md §10 "Remove flow", tests.md C-18/C-19): Remove opens
 * `RemoveAttachmentDialog`; once its own client-side validation passes
 * this calls `removeAttachment` (api-spec.md §4.4) and, on success,
 * reports the updated attachment via `onAttachmentRemoved` and shows a
 * `role="status"` toast (AC-34). A `400` (bad reason, defence in depth —
 * the dialog's client-side check should already have caught this) or
 * `409` (already removed) keeps the dialog open with a distinguishable
 * message instead of a generic failure (AC-35); the attachment list is
 * untouched in both cases, since `onAttachmentRemoved` is only called on
 * success.
 */
export function AttachmentSection({
  attachments,
  requesterId,
  onAttachmentRemoved,
  onDownload,
  onPreview,
}: AttachmentSectionProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The button that opened the dialog, so a cancel (button or Esc) can
  // return focus to it (ui-spec.md §10). Not used on success: the Remove
  // button no longer exists once the row becomes "Removed".
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function handleRemoveClick(
    attachment: TicketAttachment,
    trigger: HTMLButtonElement,
  ) {
    triggerRef.current = trigger;
    setToast(null);
    setDialog({ attachment, busy: false });
  }

  function handleCancel() {
    setDialog(null);
    triggerRef.current?.focus();
    triggerRef.current = null;
  }

  async function handleConfirm(reason: string) {
    if (!dialog) return;
    const { attachment } = dialog;
    setDialog({ attachment, busy: true });

    try {
      const updated = await removeAttachment(
        requesterId,
        attachment.id,
        reason,
      );
      onAttachmentRemoved(updated);
      setDialog(null);
      triggerRef.current = null;
      setToast(`"${updated.originalFilename}" was removed.`);
    } catch (error) {
      if (error instanceof RemoveAttachmentError) {
        if (error.code === "VALIDATION_FAILED") {
          setDialog({
            attachment,
            busy: false,
            serverFieldError: error.fields?.[0]?.message ?? error.message,
          });
          return;
        }
        // ALREADY_REMOVED (409) — a conflict, not a field problem.
        setDialog({ attachment, busy: false, conflictError: error.message });
        return;
      }
      setDialog({
        attachment,
        busy: false,
        conflictError:
          "Could not remove this attachment. Please check your connection and try again.",
      });
    }
  }

  return (
    <>
      <AttachmentList
        attachments={attachments}
        onDownload={onDownload}
        onPreview={onPreview}
        onRemove={handleRemoveClick}
      />

      {dialog && (
        <RemoveAttachmentDialog
          fileName={dialog.attachment.originalFilename}
          busy={dialog.busy}
          conflictError={dialog.conflictError}
          serverFieldError={dialog.serverFieldError}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        />
      )}

      {toast && (
        <div role="status" className="zen-attachment-section__toast">
          {toast}
        </div>
      )}
    </>
  );
}
