import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "./Button";
import "./AttachmentUploader.css";

/** Allowed attachment types (specification.md BR-21). */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/**
 * Allowed extensions, matching the `accept` attribute below exactly
 * (ui-spec.md §8: `accept=".jpg,.jpeg,.png,.webp,.pdf"` ... "validated
 * client-side (extension, size, running count ≤ 5)"). `accept` is only a
 * file-picker hint — it does not constrain drag-and-drop or a
 * programmatic File — so the extension must also be checked here.
 */
const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
]);

/**
 * Lowercased extension of `filename`, including the leading dot, or ""
 * if there isn't one. Uses the LAST dot, so `report.final.pdf` yields
 * `.pdf`; a name with no dot (or a dot only as the first character, e.g.
 * a hidden file) yields "".
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return filename.slice(lastDot).toLowerCase();
}

/** Maximum attachment size in bytes — 5 MB exactly is allowed (BR-22). */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum active (non-removed) attachments per ticket (BR-23). */
const MAX_ATTACHMENTS = 5;

const TOO_MANY_MESSAGE = "Maximum of 5 active attachments";

/** One user-selected file waiting to be uploaded. */
export interface QueuedAttachment {
  /** Client-only id (never sent to the server) used to key rows and support Remove. */
  id: string;
  file: File;
}

export interface AttachmentUploaderProps {
  /** Controlled queue of not-yet-uploaded files (BR-26: the caller owns this so it can be preserved across a failed submit). */
  queued: QueuedAttachment[];
  /** Called with the full next queue whenever a valid file is added or a queued file is removed. */
  onQueuedChange: (queued: QueuedAttachment[]) => void;
  /**
   * Attachments that already exist on the ticket and count toward the
   * 5-max ceiling (BR-23) — 0 for a ticket that doesn't exist yet
   * (Create Ticket). The component never fetches this itself.
   */
  activeCount: number;
  /** Disables Add/Remove entirely, independent of the 5-max rule (e.g. while the ticket create request is in flight). */
  disabled?: boolean;
  /** Unique id prefix so more than one instance can render on a page without id collisions. */
  idPrefix?: string;
  /** Button label — ui-spec.md §8 uses "Add files", §10 uses "Add attachment". */
  addButtonLabel?: string;
}

interface RejectedFile {
  id: string;
  name: string;
  message: string;
}

function validateFile(file: File): string | undefined {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return "Unsupported file type — not added.";
  }
  if (!ALLOWED_EXTENSIONS.has(getFileExtension(file.name))) {
    return "Unsupported file type — not added.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "File is larger than 5 MB — not added.";
  }
  return undefined;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Shared attachment picker (ui-spec.md §8 "Attachment sub-component",
 * §10 "Add attachment"), used by Create Ticket and (a later slice)
 * Ticket Detail.
 *
 * Client-side validation happens before anything is queued
 * (specification.md BR-21/BR-22, AC-18/AC-19): a rejected file gets a
 * per-file message and is never added to `queued`. The control disables
 * itself with a tooltip once `activeCount + queued.length` reaches 5
 * (BR-23, AC-20). This component never fetches or uploads — it only
 * hands the caller a validated `File[]` to act on.
 */
export function AttachmentUploader({
  queued,
  onQueuedChange,
  activeCount,
  disabled = false,
  idPrefix = "attachment-uploader",
  addButtonLabel = "+ Add files",
}: AttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Rejections are ephemeral, per-selection feedback (ui-spec.md §8) —
  // deliberately not part of `queued`, which the caller owns so it can be
  // preserved verbatim across a failed submit (BR-26).
  const [rejections, setRejections] = useState<RejectedFile[]>([]);

  const inputId = `${idPrefix}-input`;
  const totalCount = activeCount + queued.length;
  const atLimit = totalCount >= MAX_ATTACHMENTS;
  const addDisabled = disabled || atLimit;

  function handleAddClick() {
    inputRef.current?.click();
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Reset so selecting the exact same file again still fires a change.
    event.target.value = "";

    const nextQueued = [...queued];
    const nextRejections: RejectedFile[] = [];

    for (const file of files) {
      const validationError = validateFile(file);
      if (validationError) {
        nextRejections.push({
          id: crypto.randomUUID(),
          name: file.name,
          message: validationError,
        });
        continue;
      }

      const remaining = MAX_ATTACHMENTS - activeCount - nextQueued.length;
      if (remaining <= 0) {
        nextRejections.push({
          id: crypto.randomUUID(),
          name: file.name,
          message: `${TOO_MANY_MESSAGE} — not added.`,
        });
        continue;
      }

      nextQueued.push({ id: crypto.randomUUID(), file });
    }

    if (nextQueued.length !== queued.length) {
      onQueuedChange(nextQueued);
    }
    if (nextRejections.length > 0) {
      setRejections((current) => [...current, ...nextRejections]);
    }
  }

  function handleRemove(id: string) {
    onQueuedChange(queued.filter((item) => item.id !== id));
  }

  const hasRows = queued.length > 0 || rejections.length > 0;

  return (
    <div className="zen-attachment-uploader">
      <div className="zen-attachment-uploader__controls">
        <label htmlFor={inputId} className="zen-visually-hidden">
          Attachment files
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          multiple
          className="zen-visually-hidden"
          onChange={handleFilesSelected}
          disabled={addDisabled}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={handleAddClick}
          disabled={addDisabled}
          title={atLimit ? TOO_MANY_MESSAGE : undefined}
        >
          {addButtonLabel}
        </Button>
        <span className="zen-attachment-uploader__hint">
          JPG, PNG, WEBP, or PDF · up to 5 MB each
        </span>
      </div>

      {hasRows && (
        <ul className="zen-attachment-uploader__list">
          {queued.map((item) => (
            <li key={item.id} className="zen-attachment-uploader__item">
              <span
                className="zen-attachment-uploader__name"
                title={item.file.name}
              >
                {item.file.name}
              </span>
              <span className="zen-attachment-uploader__size">
                {formatFileSize(item.file.size)}
              </span>
              <Button
                type="button"
                variant="tertiary"
                disabled={disabled}
                onClick={() => handleRemove(item.id)}
              >
                Remove
              </Button>
            </li>
          ))}
          {rejections.map((item) => (
            <li
              key={item.id}
              className="zen-attachment-uploader__item zen-attachment-uploader__item--rejected"
            >
              <span
                className="zen-attachment-uploader__name"
                title={item.name}
              >
                {item.name}
              </span>
              <span role="alert" className="zen-attachment-uploader__error">
                <span aria-hidden="true">✗</span> {item.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
