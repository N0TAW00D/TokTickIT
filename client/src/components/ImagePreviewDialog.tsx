import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { downloadAttachment, type TicketAttachment } from "../tickets/api";
import "./ImagePreviewDialog.css";

/** Focusable elements inside the dialog, in DOM order, for the Tab trap. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export interface ImagePreviewDialogProps {
  /** The active image attachment being previewed (ui-spec.md §10, BR-34). */
  attachment: TicketAttachment;
  requesterId: number;
  /** Closes the lightbox; the caller restores focus to the triggering Preview button. */
  onClose: () => void;
}

type LoadState = "loading" | "loaded" | "error";

/**
 * Inline image lightbox for an active image attachment (ui-spec.md §10:
 * "`Preview` (opens inline lightbox)", BR-34). The image endpoint needs
 * the `X-Requester-Id` header, so the bytes are fetched via
 * `downloadAttachment` and shown from an object URL rather than a bare
 * `<img src>` pointing at the API.
 *
 * Modal shell matches `RemoveAttachmentDialog`: `role="dialog"`,
 * `aria-modal`, an accessible label, `Esc` + a close button to dismiss,
 * and a Tab focus trap. Focus return to the trigger is the caller's job
 * (same split as the Remove dialog). The object URL is revoked when the
 * dialog unmounts or the attachment changes.
 */
export function ImagePreviewDialog({
  attachment,
  requesterId,
  onClose,
}: ImagePreviewDialogProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Initial focus lands inside the dialog (ui-spec.md §12: "dialogs trap
  // focus"), on the first control — the Close button.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    setState("loading");
    setObjectUrl(null);

    downloadAttachment(requesterId, attachment.id)
      .then(({ blob }) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
        setState("loaded");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [requesterId, attachment.id]);

  // Esc closes; Tab/Shift+Tab wrap within the dialog (ui-spec.md §12).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
  }, [onClose]);

  return (
    <div className="zen-image-preview__overlay">
      <div
        ref={dialogRef}
        className="zen-image-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zen-image-preview-title"
      >
        <div className="zen-image-preview__header">
          <h2
            id="zen-image-preview-title"
            className="zen-image-preview__title"
            title={attachment.originalFilename}
          >
            {attachment.originalFilename}
          </h2>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="zen-image-preview__body">
          {state === "loading" && (
            <div role="status" className="zen-image-preview__message">
              Loading preview…
            </div>
          )}
          {state === "error" && (
            <div role="alert" className="zen-image-preview__message">
              <span aria-hidden="true">⚠</span> Could not load this preview.
              You can still download the file.
            </div>
          )}
          {state === "loaded" && objectUrl && (
            <img
              src={objectUrl}
              alt={attachment.originalFilename}
              className="zen-image-preview__image"
            />
          )}
        </div>
      </div>
    </div>
  );
}
