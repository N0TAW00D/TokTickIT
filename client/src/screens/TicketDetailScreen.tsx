import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { PriorityBadge } from "../components/PriorityBadge";
import { StatusBadge } from "../components/StatusBadge";
import { AttachmentSection } from "../components/AttachmentSection";
import { MessageThread } from "../components/MessageThread";
import { ConfirmResolvedDialog } from "../components/ConfirmResolvedDialog";
import {
  fetchComments,
  fetchTicketDetail,
  postComment,
  postRequesterResolved,
  RequesterResolvedConflictError,
  TicketNotFoundError,
  type TicketAttachment,
  type TicketDetailResponse,
} from "../tickets/api";
import { formatDateTime, formatDateTimeWithYear } from "../tickets/formatDateTime";
import "./TicketDetailScreen.css";

/** ui-spec.md §7: the button is hidden once the ticket reaches any of these. */
const RESOLUTION_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
]);

interface StaticFieldProps {
  label: string;
  value: string;
  fullWidth?: boolean;
  multiline?: boolean;
}

/**
 * One read-only header field (ui-spec.md §10, FR-32, BR-39): a label paired
 * with plain static text — never an `<input>`/`<textarea>`, since this
 * screen has no editable fields (tests.md C-29: "static text, no inputs").
 * Single-line values truncate with an ellipsis and carry the full value in
 * `title` rather than clipping silently (ui-spec.md §11); Summary and
 * Description wrap in full instead, since this is the one screen meant to
 * show them completely.
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
          ? "zen-ticket-detail__field zen-ticket-detail__field--full"
          : "zen-ticket-detail__field"
      }
    >
      <span className="zen-ticket-detail__field-label">{label}</span>
      <div
        className={
          multiline
            ? "zen-ticket-detail__field-value zen-ticket-detail__field-value--multiline"
            : "zen-ticket-detail__field-value"
        }
        title={multiline ? undefined : value}
      >
        {value}
      </div>
    </div>
  );
}

/** Same label/value shell as StaticField, for the two badge fields. */
function StaticBadgeField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="zen-ticket-detail__field">
      <span className="zen-ticket-detail__field-label">{label}</span>
      <div className="zen-ticket-detail__field-value zen-ticket-detail__field-value--badge">
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
 * Requester Ticket Detail screen (ui-spec.md §10, `/tickets/:id`).
 *
 * Read-only view of one ticket's header fields plus its attachment list
 * (ui-spec.md §10 "Attachment section", tests.md C-20/C-21: active rows
 * with their per-type controls, removed rows as metadata only), wired to
 * the Remove confirmation dialog via `AttachmentSection` (tests.md
 * C-18/C-19), the per-row Download/Preview actions, and the Add
 * Attachment control (slice 14d). A successful removal, upload, or the
 * (unchanged) header all flow through `state.ticket.attachments` in-place,
 * so the rows and the "N active / M total" heading update without a full
 * re-fetch.
 */
export function TicketDetailScreen() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  const parsedId = params.id !== undefined ? Number(params.id) : NaN;
  const validId = Number.isInteger(parsedId) && parsedId > 0;

  const [state, setState] = useState<DetailState>({ phase: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  // "Problem Appears Resolved" (ui-spec.md §7). `justResolvedAt` is set
  // client-side the moment a confirm succeeds, so the button is replaced by
  // the read-only note immediately, without waiting on a full re-fetch;
  // `state.ticket.requesterResolvedAt` (from the server) covers the case
  // where the screen loads a ticket already resolved in an earlier visit.
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveSubmitting, setResolveSubmitting] = useState(false);
  const [resolveError, setResolveError] = useState<string | undefined>();
  const [justResolvedAt, setJustResolvedAt] = useState<string | null>(null);
  // The 409 conflict banner (ui-spec.md §7) — wired to the resolution
  // indication only, per api-spec.md §3.2's contract carrying no 409 for
  // comment posting (see routes/tickets.ts's own doc comment for the
  // judgment call this mirrors).
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

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
    navigate("/tickets");
  }

  /**
   * Splices the server's updated attachment (post-removal) into the
   * currently-loaded ticket's `attachments[]` in place, so `AttachmentList`
   * re-renders that one row as "Removed" and the section heading's active
   * count drops — without re-fetching the whole ticket.
   */
  function handleAttachmentRemoved(updated: TicketAttachment) {
    setState((previous) => {
      if (previous.phase !== "loaded") return previous;
      return {
        phase: "loaded",
        ticket: {
          ...previous.ticket,
          attachments: previous.ticket.attachments.map((attachment) =>
            attachment.id === updated.id ? updated : attachment,
          ),
        },
      };
    });
  }

  /**
   * Appends a just-uploaded attachment (from the Add control) to the
   * currently-loaded ticket's `attachments[]`, so its row appears and the
   * section heading's "N active / M total" counts both rise — same
   * in-place update as `handleAttachmentRemoved`, no re-fetch.
   */
  function handleAttachmentAdded(added: TicketAttachment) {
    setState((previous) => {
      if (previous.phase !== "loaded") return previous;
      return {
        phase: "loaded",
        ticket: {
          ...previous.ticket,
          attachments: [...previous.ticket.attachments, added],
        },
      };
    });
  }

  function handleConfirmResolved() {
    if (state.phase !== "loaded") return;
    setResolveSubmitting(true);
    setResolveError(undefined);

    postRequesterResolved(state.ticket.id)
      .then(() => {
        setJustResolvedAt(new Date().toISOString());
        setResolveDialogOpen(false);
      })
      .catch((error: unknown) => {
        if (error instanceof RequesterResolvedConflictError) {
          setResolveDialogOpen(false);
          setConflictMessage(error.message);
          return;
        }
        setResolveError(
          "Could not record this. Please check your connection and try again.",
        );
      })
      .finally(() => setResolveSubmitting(false));
  }

  function handleRefreshAfterConflict() {
    setConflictMessage(null);
    handleRetry();
  }

  return (
    <AppShell>
      <div className="zen-ticket-detail__breadcrumb-row">
        <nav aria-label="Breadcrumb" className="zen-ticket-detail__breadcrumb">
          <Link to="/tickets">My Tickets</Link>
          <span aria-hidden="true"> &rsaquo; </span>
          <span>Ticket Details</span>
        </nav>

        <div className="zen-ticket-detail__header-actions">
          {state.phase === "loaded" &&
            !(justResolvedAt ?? state.ticket.requesterResolvedAt) &&
            !RESOLUTION_TERMINAL_STATUSES.has(state.ticket.status) && (
              <Button
                variant="secondary"
                onClick={() => setResolveDialogOpen(true)}
              >
                Problem appears resolved
              </Button>
            )}
          {state.phase !== "not-found" && (
            <Button variant="secondary" onClick={handleBack}>
              <span aria-hidden="true">&larr; </span>
              Back to My Tickets
            </Button>
          )}
        </div>
      </div>

      <h1>Ticket Details</h1>

      {conflictMessage && (
        <div role="alert" className="zen-ticket-detail__conflict-banner">
          <span>{conflictMessage}</span>
          <Button variant="secondary" onClick={handleRefreshAfterConflict}>
            Refresh
          </Button>
        </div>
      )}

      {state.phase === "loading" && <LoadingState label="Loading ticket…" />}

      {state.phase === "error" && (
        <ErrorState message={state.message} onRetry={handleRetry} />
      )}

      {state.phase === "not-found" && (
        <EmptyState
          title="Ticket not found"
          description="This ticket doesn't exist or isn't associated with your account."
          action={
            <Button variant="primary" onClick={handleBack}>
              <span aria-hidden="true">&larr; </span>
              Back to My Tickets
            </Button>
          }
        />
      )}

      {state.phase === "loaded" && (
        <>
          <section className="zen-ticket-detail__card">
            <h2>Ticket information</h2>

            <div className="zen-ticket-detail__grid">
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
              <StaticBadgeField label="Current Status">
                <StatusBadge value={state.ticket.status} />
              </StaticBadgeField>
              <StaticField
                label="Related System"
                value={state.ticket.relatedSystem.name}
              />
              {/* ui-spec.md §7: read-only; IT Priority is never shown to
                  the Requester (the server never even sends it — see
                  TicketDetailResponse). */}
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

            {(justResolvedAt ?? state.ticket.requesterResolvedAt) && (
              <p className="zen-ticket-detail__resolved-note">
                You reported this looks resolved on{" "}
                {formatDateTime(
                  (justResolvedAt ?? state.ticket.requesterResolvedAt) as string,
                )}
                .
              </p>
            )}
          </section>

          {/* Clear separation from the ticket information card above
              (ui-spec.md §10, labsheet §8.5). */}
          <section className="zen-ticket-detail__card">
            <h2>
              Attachments (
              {state.ticket.attachments.filter((a) => !a.isRemoved).length}
              {" active / "}
              {state.ticket.attachments.length} total)
            </h2>
            <AttachmentSection
              attachments={state.ticket.attachments}
              ticketId={state.ticket.id}
              onAttachmentRemoved={handleAttachmentRemoved}
              onAttachmentAdded={handleAttachmentAdded}
            />
          </section>

          {/* ui-spec.md §7/§8: Public Comments thread, below Attachments. */}
          <MessageThread
            variant="public"
            fetchEntries={() => fetchComments(state.ticket.id)}
            postEntry={(body) => postComment(state.ticket.id, body)}
          />
        </>
      )}

      {resolveDialogOpen && (
        <ConfirmResolvedDialog
          busy={resolveSubmitting}
          errorMessage={resolveError}
          onCancel={() => setResolveDialogOpen(false)}
          onConfirm={handleConfirmResolved}
        />
      )}
    </AppShell>
  );
}
