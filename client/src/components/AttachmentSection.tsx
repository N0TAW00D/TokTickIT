import { useRef, useState } from "react";
import { Button } from "./Button";
import { AttachmentList } from "./AttachmentList";
import { RemoveAttachmentDialog } from "./RemoveAttachmentDialog";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import {
  AttachmentUploader,
  type QueuedAttachment,
} from "./AttachmentUploader";
import {
  AttachmentRemovedError,
  downloadAttachment,
  removeAttachment,
  RemoveAttachmentError,
  uploadAttachment,
  UploadAttachmentError,
  type TicketAttachment,
} from "../tickets/api";
import { saveBlob } from "../tickets/downloadFile";
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

/**
 * One file whose immediate upload from the Add control failed on the
 * server (`415`/`413`/`409`) or the network — it gets its own
 * "Upload failed — retry" row with `Retry` + `Dismiss` (ui-spec.md §10
 * row table), keyed by a client-only id so each row's controls act on
 * exactly its file.
 */
interface FailedUpload {
  id: string;
  file: File;
  /** The 409/413/415/network wording from `uploadErrorMessage`, shown as the row's detail line. */
  message: string;
  /** A re-attempt is in flight — the row's `Retry` shows its busy state and `Dismiss` is held. */
  retrying: boolean;
}

const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Message for a failed upload from the Add control. Only the `413`/`415`
 * client-side wording is frozen (the uploader itself shows those before a
 * request is ever sent, ui-spec.md §8); these server-path strings are not
 * pinned by docs/lab-02/*.md, except that AC-20's `409` case must name the
 * "Maximum of 5 active attachments" limit (ui-spec.md §10).
 */
function uploadErrorMessage(error: unknown, fileName: string): string {
  if (error instanceof UploadAttachmentError) {
    switch (error.code) {
      case "UNSUPPORTED_TYPE":
        return `"${fileName}" was rejected: unsupported file type.`;
      case "FILE_TOO_LARGE":
        return `"${fileName}" was rejected: larger than 5 MB.`;
      case "ATTACHMENT_LIMIT":
        return "Maximum of 5 active attachments — this ticket is already at the limit.";
    }
  }
  return `Could not upload "${fileName}". Please check your connection and try again.`;
}

export interface AttachmentSectionProps {
  attachments: TicketAttachment[];
  requesterId: number;
  /** The parent ticket's id — needed to upload a new attachment (api-spec.md §4.1). */
  ticketId: number;
  /**
   * Called with the server's updated attachment metadata (`isRemoved:
   * true`, `removedAt`, `removedReason`) once a removal succeeds — the
   * caller is expected to replace that attachment in its own ticket state
   * so the row and the "N active / M total" heading both update.
   */
  onAttachmentRemoved: (updated: TicketAttachment) => void;
  /**
   * Called with the server's newly-created attachment once an upload from
   * the Add control succeeds — the caller appends it to its own ticket
   * state so the row appears and the "N active / M total" heading updates.
   * When omitted, the Add control is not rendered (e.g. AttachmentSection
   * rendered in isolation for the remove-flow tests).
   */
  onAttachmentAdded?: (added: TicketAttachment) => void;
}

/**
 * Wraps the presentational `AttachmentList` with every per-attachment
 * action on Requester Ticket Detail (ui-spec.md §10, tests.md
 * C-17..C-21):
 *
 * - **Download** (`onDownload`): fetches the bytes via `downloadAttachment`
 *   (api-spec.md §4.3, with the `X-Requester-Id` header) and saves them
 *   through a transient `<a download>`. A `410` (soft-removed between page
 *   load and click) surfaces a non-blocking `role="alert"` rather than
 *   crashing (BR-33, AC-34).
 * - **Preview** (`onPreview`, image rows only): opens `ImagePreviewDialog`,
 *   an inline lightbox that fetches the image the same authenticated way
 *   (BR-34).
 * - **Remove**: opens `RemoveAttachmentDialog`; once its own client-side
 *   validation passes this calls `removeAttachment` (api-spec.md §4.4) and,
 *   on success, reports the updated attachment via `onAttachmentRemoved`
 *   and shows a `role="status"` toast (AC-34). A `400` or `409` keeps the
 *   dialog open with a distinguishable message (AC-35).
 * - **Add attachment** (`AttachmentUploader`, shown only when
 *   `onAttachmentAdded` is provided): a validated file uploads immediately
 *   via `uploadAttachment` — there is no queue-then-submit step here since
 *   the ticket already exists. Disabled with the "Maximum of 5 active
 *   attachments" tooltip once 5 active attachments exist (AC-20, BR-23).
 */
export function AttachmentSection({
  attachments,
  requesterId,
  ticketId,
  onAttachmentRemoved,
  onAttachmentAdded,
}: AttachmentSectionProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TicketAttachment | null>(null);
  const [failedUploads, setFailedUploads] = useState<FailedUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  // AttachmentUploader is a controlled queue component; on Ticket Detail we
  // upload immediately and never persist a queue, so this stays empty.
  const [queued, setQueued] = useState<QueuedAttachment[]>([]);
  // The button that opened the dialog, so a cancel (button or Esc) can
  // return focus to it (ui-spec.md §10). Not used on success: the Remove
  // button no longer exists once the row becomes "Removed".
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Same, for the Preview button (ui-spec.md §12: dialogs restore focus).
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  const activeCount = attachments.filter(
    (attachment) => !attachment.isRemoved,
  ).length;

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

  async function handleDownload(attachment: TicketAttachment) {
    setDownloadError(null);
    try {
      const { blob, filename } = await downloadAttachment(
        requesterId,
        attachment.id,
      );
      saveBlob(blob, filename ?? attachment.originalFilename);
    } catch (error) {
      if (error instanceof AttachmentRemovedError) {
        // Copy not frozen by docs/lab-02/*.md.
        setDownloadError(
          `"${attachment.originalFilename}" was removed and can no longer be downloaded. Refresh the page to see its current state.`,
        );
        return;
      }
      setDownloadError(
        `Could not download "${attachment.originalFilename}". Please check your connection and try again.`,
      );
    }
  }

  function handlePreview(
    attachment: TicketAttachment,
    trigger: HTMLButtonElement,
  ) {
    previewTriggerRef.current = trigger;
    setPreview(attachment);
  }

  function handlePreviewClose() {
    setPreview(null);
    previewTriggerRef.current?.focus();
    previewTriggerRef.current = null;
  }

  async function handleQueuedChange(next: QueuedAttachment[]) {
    // `next` is the uploader's proposed queue: every entry is a file that
    // already passed the uploader's client-side type/size/count checks
    // (ui-spec.md §8). On Ticket Detail there is no submit step — upload
    // each one now and keep our own queue empty.
    if (next.length === 0) return;
    setUploading(true);
    try {
      for (const item of next) {
        try {
          const added = await uploadAttachment(
            requesterId,
            ticketId,
            item.file,
          );
          onAttachmentAdded?.(added);
        } catch (error) {
          // Give the failed file its own "Upload failed — retry" row
          // (ui-spec.md §10) and stop the batch here — the same
          // stop-on-first-failure behaviour slice 14d shipped; any files
          // after this one in the selection are simply not attempted.
          setFailedUploads((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              file: item.file,
              message: uploadErrorMessage(error, item.file.name),
              retrying: false,
            },
          ]);
          break;
        }
      }
    } finally {
      setUploading(false);
      setQueued([]);
    }
  }

  /**
   * `Retry` on a failed-upload row: re-attempts the upload for that exact
   * file. On success the row is removed and the attachment is reported via
   * `onAttachmentAdded` (the normal success path — a real active row
   * appears and the "N active / M total" heading updates). On another
   * failure the row stays with refreshed wording.
   */
  async function handleRetryUpload(id: string) {
    const target = failedUploads.find((item) => item.id === id);
    if (!target || target.retrying) return;

    setFailedUploads((current) =>
      current.map((item) =>
        item.id === id ? { ...item, retrying: true } : item,
      ),
    );

    try {
      const added = await uploadAttachment(requesterId, ticketId, target.file);
      onAttachmentAdded?.(added);
      setFailedUploads((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      setFailedUploads((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                retrying: false,
                message: uploadErrorMessage(error, target.file.name),
              }
            : item,
        ),
      );
    }
  }

  /** `Dismiss` on a failed-upload row: drop the row, nothing else. */
  function handleDismissUpload(id: string) {
    setFailedUploads((current) => current.filter((item) => item.id !== id));
  }

  return (
    <>
      {onAttachmentAdded && (
        <>
          <AttachmentUploader
            idPrefix="ticket-detail-attachments"
            queued={queued}
            onQueuedChange={handleQueuedChange}
            activeCount={activeCount}
            disabled={uploading}
            addButtonLabel="+ Add attachment"
          />
          {failedUploads.length > 0 && (
            <ul
              className="zen-attachment-uploader__list zen-attachment-failed"
              role="alert"
            >
              {failedUploads.map((item) => (
                <li
                  key={item.id}
                  className="zen-attachment-uploader__item zen-attachment-uploader__item--failed"
                >
                  <span
                    className="zen-attachment-uploader__name"
                    title={item.file.name}
                  >
                    {item.file.name}
                  </span>
                  <span className="zen-attachment-failed__status">
                    <span aria-hidden="true">⚠</span> Upload failed — retry
                  </span>
                  <span className="zen-attachment-failed__detail">
                    {item.message}
                  </span>
                  <span className="zen-attachment-failed__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      busy={item.retrying}
                      onClick={() => handleRetryUpload(item.id)}
                    >
                      Retry
                    </Button>
                    <Button
                      type="button"
                      variant="tertiary"
                      disabled={item.retrying}
                      onClick={() => handleDismissUpload(item.id)}
                    >
                      Dismiss
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <AttachmentList
        attachments={attachments}
        onDownload={handleDownload}
        onPreview={handlePreview}
        onRemove={handleRemoveClick}
      />

      {downloadError && (
        <div role="alert" className="zen-attachment-section__error">
          <span aria-hidden="true">⚠</span> {downloadError}
        </div>
      )}

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

      {preview && IMAGE_MIME_TYPES.has(preview.mimeType) && (
        <ImagePreviewDialog
          attachment={preview}
          requesterId={requesterId}
          onClose={handlePreviewClose}
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
