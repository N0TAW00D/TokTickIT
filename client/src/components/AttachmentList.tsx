import { Button } from "./Button";
import { formatDateTime } from "../tickets/formatDateTime";
import { formatFileSize } from "../tickets/formatFileSize";
import type { TicketAttachment } from "../tickets/api";
import "./AttachmentList.css";

/**
 * Active image MIME types (specification.md BR-21/BR-34): only these get
 * an inline `Preview` control. PDFs (the only other allowed type) get
 * `Download` only.
 */
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Human-readable type label for a removed row. Only removed rows need
 * this as its own visible field (ui-spec.md §10 row table: "🚫 icon, name,
 * size, type, ..."); active rows carry the type via their icon alone (the
 * same table's Active rows list no separate "type" field).
 */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "application/pdf": "PDF",
};

function describeType(mimeType: string): string {
  return TYPE_LABELS[mimeType] ?? mimeType;
}

export interface AttachmentListProps {
  attachments: TicketAttachment[];
  /**
   * Wired by a later slice (Download actually fetching/saving the file).
   * Left unwired here, the button still renders per C-21 — it just has no
   * effect yet.
   */
  onDownload?: (attachment: TicketAttachment) => void;
  /** Wired by a later slice (the inline preview lightbox, ui-spec.md §10). */
  onPreview?: (attachment: TicketAttachment) => void;
  /**
   * Wired by slice 14c (the Remove confirmation dialog: required reason,
   * focus trap, Esc, toast, 400 handling). Receives the clicked button
   * element as its second argument so the caller can restore focus to it
   * when the dialog closes without success (ui-spec.md §10: "returns
   * focus to the triggering Remove button") — using `event.currentTarget`
   * rather than `document.activeElement` so this works even when the
   * click didn't itself move focus (e.g. `fireEvent.click` in tests).
   */
  onRemove?: (attachment: TicketAttachment, trigger: HTMLButtonElement) => void;
}

/**
 * Attachment rows for Requester Ticket Detail (ui-spec.md §10 "Attachment
 * section", tests.md C-20/C-21). Purely presentational, like
 * `AttachmentUploader`: it renders the correct controls for each
 * attachment's state and hands clicks to the caller via optional
 * callbacks — it never fetches, downloads, or removes anything itself.
 */
export function AttachmentList({
  attachments,
  onDownload,
  onPreview,
  onRemove,
}: AttachmentListProps) {
  if (attachments.length === 0) return null;

  return (
    <ul className="zen-attachment-list">
      {attachments.map((attachment) =>
        attachment.isRemoved ? (
          <RemovedRow key={attachment.id} attachment={attachment} />
        ) : (
          <ActiveRow
            key={attachment.id}
            attachment={attachment}
            onDownload={onDownload}
            onPreview={onPreview}
            onRemove={onRemove}
          />
        ),
      )}
    </ul>
  );
}

interface ActiveRowProps {
  attachment: TicketAttachment;
  onDownload?: (attachment: TicketAttachment) => void;
  onPreview?: (attachment: TicketAttachment) => void;
  onRemove?: (attachment: TicketAttachment, trigger: HTMLButtonElement) => void;
}

/**
 * Active, image (BR-34): Preview + Download + Remove.
 * Active, PDF (BR-34): Download + Remove only — no Preview.
 */
function ActiveRow({ attachment, onDownload, onPreview, onRemove }: ActiveRowProps) {
  const isImage = IMAGE_MIME_TYPES.has(attachment.mimeType);

  return (
    <li className="zen-attachment-list__item">
      <span className="zen-attachment-list__icon" aria-hidden="true">
        {isImage ? "🖼" : "📄"}
      </span>
      <span
        className="zen-attachment-list__name"
        title={attachment.originalFilename}
      >
        {attachment.originalFilename}
      </span>
      <span className="zen-attachment-list__size">
        {formatFileSize(attachment.fileSize)}
      </span>
      <span className="zen-attachment-list__actions">
        {isImage && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onPreview?.(attachment)}
          >
            Preview
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() => onDownload?.(attachment)}
        >
          Download
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={(event) =>
            onRemove?.(attachment, event.currentTarget)
          }
        >
          Remove
        </Button>
      </span>
    </li>
  );
}

/**
 * Removed (BR-33, AC-36): metadata only — name, size, type, removed date
 * and reason — and explicitly no Download/Preview/Remove control.
 */
function RemovedRow({ attachment }: { attachment: TicketAttachment }) {
  const removedAtLabel = attachment.removedAt
    ? formatDateTime(attachment.removedAt)
    : "";

  return (
    <li className="zen-attachment-list__item zen-attachment-list__item--removed">
      <span className="zen-attachment-list__icon" aria-hidden="true">
        🚫
      </span>
      <span
        className="zen-attachment-list__name"
        title={attachment.originalFilename}
      >
        {attachment.originalFilename}
      </span>
      <span className="zen-attachment-list__size">
        {formatFileSize(attachment.fileSize)}
      </span>
      <span className="zen-attachment-list__type">
        {describeType(attachment.mimeType)}
      </span>
      <span className="zen-attachment-list__removed-meta">
        Removed {removedAtLabel} &middot; &quot;{attachment.removedReason}
        &quot;
      </span>
    </li>
  );
}
