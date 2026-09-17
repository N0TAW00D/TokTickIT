import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { PriorityBadge } from "../components/PriorityBadge";
import { StatusBadge } from "../components/StatusBadge";
import { AttachmentList } from "../components/AttachmentList";
import { ImagePreviewDialog } from "../components/ImagePreviewDialog";
import { MessageThread } from "../components/MessageThread";
import {
  AttachmentRemovedError,
  downloadAttachment,
  fetchComments,
  fetchTicketDetail,
  postComment,
  TicketNotFoundError,
  type TicketAttachment,
  type TicketDetailResponse,
} from "../tickets/api";
import { saveBlob } from "../tickets/downloadFile";
import { formatDateTime, formatDateTimeWithYear } from "../tickets/formatDateTime";
import "./StaffTicketDetailScreen.css";

/**
 * Active image MIME types (specification.md BR-21/BR-34): only these get an
 * inline `Preview` control from `AttachmentList` — mirrors
 * `AttachmentSection`'s own copy of this same set (Requester Ticket Detail),
 * since this screen wires `ImagePreviewDialog` itself rather than reusing
 * that Requester-specific wrapper (see this file's own doc comment below).
 */
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface StaticFieldProps {
  label: string;
  value: string;
  fullWidth?: boolean;
  multiline?: boolean;
}

/**
 * One read-only header field (ui-spec.md §10) — a label paired with plain
 * static text, same shell as the Requester Ticket Detail screen's own
 * `StaticField` (`TicketDetailScreen.tsx`). Duplicated rather than shared
 * since neither screen exports it and this dispatch's job is a sibling
 * screen, not a shared-component refactor.
 */
function StaticField({
  label,
  value,
  fullWidth = false,
  multiline = false,
}: StaticFieldProps) {
  return (
    <div
      className={
        fullWidth
          ? "zen-staff-detail__field zen-staff-detail__field--full"
          : "zen-staff-detail__field"
      }
    >
      <span className="zen-staff-detail__field-label">{label}</span>
      <div
        className={
          multiline
            ? "zen-staff-detail__field-value zen-staff-detail__field-value--multiline"
            : "zen-staff-detail__field-value"
        }
        title={multiline ? undefined : value}
      >
        {value}
      </div>
    </div>
  );
}

/** Same label/value shell as StaticField, for the badge fields. */
function StaticBadgeField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="zen-staff-detail__field">
      <span className="zen-staff-detail__field-label">{label}</span>
      <div className="zen-staff-detail__field-value zen-staff-detail__field-value--badge">
        {children}
      </div>
    </div>
  );
}

type DetailState =
  | { phase: "loading" }
  | { phase: "loaded"; ticket: TicketDetailResponse }
  | { phase: "not-found" }
  | { phase: "error"; message: string };

/**
 * IT Staff Ticket Detail screen (ui-spec.md §10, `/staff/tickets/:id`).
 *
 * This dispatch (Issue #72) builds the read-only scaffold only: the header
 * fields, Attachments (download/preview — no upload or removal), and the
 * Public Comments thread, plus the screen's loading/not-found/error states.
 * The operational panel (editable Ticket Owner, IT Priority and Status —
 * ui-spec.md §10's editable table) is intentionally NOT built here; each of
 * those three controls is called out below with a
 * `TODO(#72): editable in a later dispatch` comment marking exactly where a
 * later dispatch replaces the read-only rendering with its interactive
 * control. Internal Notes (ui-spec.md §8) is also a later dispatch and is
 * not present here at all.
 *
 * Reachable by both IT_STAFF and ADMINISTRATOR (App.tsx wraps this route
 * with `RequireRole allowedRoles={["IT_STAFF", "ADMINISTRATOR"]}`, unlike
 * `/staff/tickets` which is IT_STAFF only) — api-spec.md §5 gives
 * Administrator a read path here even though several write actions are
 * later denied to them server-side.
 *
 * Data comes from the existing `fetchTicketDetail`, the same call the
 * Requester screen uses — the server already returns `itPriority`/`owner`/
 * `requesterResolvedAt` for a staff caller on the shared `GET
 * /api/tickets/:id` route, so no new fetch function is needed here.
 *
 * Attachments deliberately do NOT reuse `AttachmentSection`
 * (`client/src/components/AttachmentSection.tsx`): that component
 * unconditionally wires a Remove button, and ui-spec.md §10 gives IT Staff
 * "download only — no upload, no removal." Instead this screen uses the
 * lower-level, purely presentational `AttachmentList` directly, passing only
 * `onDownload`/`onPreview` (no `onRemove`, which naturally hides that
 * button — see `AttachmentList`'s own optional-prop handling), and
 * replicates just the download-fetch-and-save and preview-lightbox wiring
 * `AttachmentSection` owns internally (`handleDownload`/`handlePreview`
 * below mirror its logic exactly).
 */
export function StaffTicketDetailScreen() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  const parsedId = params.id !== undefined ? Number(params.id) : NaN;
  const validId = Number.isInteger(parsedId) && parsedId > 0;

  const [state, setState] = useState<DetailState>({ phase: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  // Download/preview wiring for AttachmentList (copied from
  // AttachmentSection's own handleDownload/handlePreview — see this file's
  // doc comment above for why that component isn't reused directly).
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TicketAttachment | null>(null);
  // Same focus-restore convention as AttachmentSection's own Preview button
  // (ui-spec.md §12: dialogs restore focus to their trigger on close).
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!validId) {
      setState({ phase: "not-found" });
      return;
    }

    let cancelled = false;
    setState({ phase: "loading" });

    fetchTicketDetail(parsedId)
      .then((ticket) => {
        if (!cancelled) setState({ phase: "loaded", ticket });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof TicketNotFoundError) {
          setState({ phase: "not-found" });
        } else {
          setState({
            phase: "error",
            message:
              "Could not load this ticket. Please check your connection and try again.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [parsedId, validId, reloadToken]);

  function handleRetry() {
    setReloadToken((token) => token + 1);
  }

  function handleBack() {
    navigate("/staff/tickets");
  }

  async function handleDownload(attachment: TicketAttachment) {
    setDownloadError(null);
    try {
      const { blob, filename } = await downloadAttachment(attachment.id);
      saveBlob(blob, filename ?? attachment.originalFilename);
    } catch (error) {
      if (error instanceof AttachmentRemovedError) {
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

  return (
    <AppShell>
      <div className="zen-staff-detail__breadcrumb-row">
        <nav aria-label="Breadcrumb" className="zen-staff-detail__breadcrumb">
          <Link to="/staff/tickets">Ticket Queue</Link>
          <span aria-hidden="true"> &rsaquo; </span>
          <span>Ticket Details</span>
        </nav>

        <div className="zen-staff-detail__header-actions">
          {state.phase !== "not-found" && (
            <Button variant="secondary" onClick={handleBack}>
              <span aria-hidden="true">&larr; </span>
              Back to Ticket Queue
            </Button>
          )}
        </div>
      </div>

      <h1>Ticket Details</h1>

      {state.phase === "loading" && <LoadingState label="Loading ticket…" />}

      {state.phase === "error" && (
        <ErrorState message={state.message} onRetry={handleRetry} />
      )}

      {state.phase === "not-found" && (
        <EmptyState
          title="Ticket not found"
          description="This ticket doesn't exist."
          action={
            <Button variant="primary" onClick={handleBack}>
              <span aria-hidden="true">&larr; </span>
              Back to Ticket Queue
            </Button>
          }
        />
      )}

      {state.phase === "loaded" && (
        <>
          <section className="zen-staff-detail__card">
            <h2>Ticket information</h2>

            <div className="zen-staff-detail__grid">
              <StaticField
                label="Ticket No."
                value={state.ticket.ticketNumber}
              />
              <StaticField
                label="Ticket Date"
                value={formatDateTimeWithYear(state.ticket.createdAt)}
              />
              <StaticField
                label="Category"
                value={state.ticket.category.name}
              />
              <StaticField
                label="Requester"
                value={state.ticket.requester.name}
              />
              <StaticBadgeField label="Requested Priority">
                <PriorityBadge value={state.ticket.requestedPriority} />
              </StaticBadgeField>
              {/* TODO(#72): editable in a later dispatch — replace with the
                  IT Priority segmented control (ui-spec.md §10's editable
                  table: three values, saves on change). Read-only for now. */}
              <StaticBadgeField label="IT Priority">
                <PriorityBadge
                  value={state.ticket.itPriority ?? ""}
                  variant="it"
                />
              </StaticBadgeField>
              {/* TODO(#72): editable in a later dispatch — replace with the
                  Status select limited to the transitions the current status
                  permits (ui-spec.md §10's editable table; server transition
                  matrix at api-spec.md §5.3). Read-only for now. */}
              <StaticBadgeField label="Current Status">
                <StatusBadge value={state.ticket.status} />
              </StaticBadgeField>
              <StaticField
                label="Related System"
                value={state.ticket.relatedSystem.name}
              />
              {/* TODO(#72): editable in a later dispatch — replace with the
                  Ticket Owner select (active IT Staff + Administrators, plus
                  "Unassigned") and its Claim button (ui-spec.md §10's
                  editable table). Read-only for now. */}
              <StaticField
                label="Ticket Owner"
                value={state.ticket.owner?.name ?? "Unassigned"}
              />
            </div>

            <StaticField
              label="Summary"
              value={state.ticket.summary}
              fullWidth
              multiline
            />
            <StaticField
              label="Description"
              value={state.ticket.description}
              fullWidth
              multiline
            />

            {state.ticket.requesterResolvedAt && (
              <p className="zen-staff-detail__resolved-note">
                The requester reported this looks resolved on{" "}
                {formatDateTime(state.ticket.requesterResolvedAt)}.
              </p>
            )}
          </section>

          {/*
           * TODO(#72): editable in a later dispatch — the operational panel
           * (ui-spec.md §10: one card, `--zen-pale` accent) belongs here,
           * between the ticket information card above and the Attachments
           * card below. It replaces the three read-only fields marked above
           * (IT Priority, Current Status, Ticket Owner) with their
           * interactive controls; it is intentionally omitted entirely in
           * this dispatch rather than stubbed, since ui-spec.md §10 draws it
           * as its own visually-distinct card, not a fragment slotted into
           * the read-only one.
           */}

          {/* Clear separation from the ticket information card above
              (ui-spec.md §10, labsheet §8.5) — mirrors the Requester
              screen's own Attachments card. */}
          <section className="zen-staff-detail__card">
            <h2>
              Attachments (
              {state.ticket.attachments.filter((a) => !a.isRemoved).length}
              {" active / "}
              {state.ticket.attachments.length} total)
            </h2>
            <AttachmentList
              attachments={state.ticket.attachments}
              onDownload={handleDownload}
              onPreview={handlePreview}
            />

            {downloadError && (
              <div role="alert" className="zen-staff-detail__download-error">
                <span aria-hidden="true">⚠</span> {downloadError}
              </div>
            )}
          </section>

          {/* ui-spec.md §8/§10: Public Comments thread. Internal Notes
              (ui-spec.md §8) is a later dispatch and is deliberately not
              present here. */}
          <MessageThread
            variant="public"
            fetchEntries={() => fetchComments(state.ticket.id)}
            postEntry={(body) => postComment(state.ticket.id, body)}
          />
        </>
      )}

      {preview && IMAGE_MIME_TYPES.has(preview.mimeType) && (
        <ImagePreviewDialog attachment={preview} onClose={handlePreviewClose} />
      )}
    </AppShell>
  );
}
