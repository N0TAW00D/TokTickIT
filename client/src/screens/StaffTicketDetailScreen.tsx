import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { SelectField, type SelectOption } from "../components/SelectField";
import { useAuth } from "../auth/AuthContext";
import { fetchAssignableUsers, type AssignableUser } from "../staff/api";
import {
  AttachmentRemovedError,
  downloadAttachment,
  fetchComments,
  fetchTicketDetail,
  InvalidOwnerError,
  patchTicketOwner,
  postComment,
  TicketNotFoundError,
  type TicketAttachment,
  type TicketDetailResponse,
} from "../tickets/api";
import { saveBlob } from "../tickets/downloadFile";
import { formatDateTime, formatDateTimeWithYear } from "../tickets/formatDateTime";
import "./StaffTicketDetailScreen.css";

/**
 * Sentinel value for the Ticket Owner select's "Unassigned" option
 * (ui-spec.md §10). Never collides with a real owner option's value, which
 * is always a stringified numeric user id.
 */
const UNASSIGNED_OWNER_VALUE = "unassigned";

/** How long the inline "Saved" tick stays visible after a successful save (ui-spec.md §10: "a success tick on save"). */
const SAVED_TICK_DURATION_MS = 2000;

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
 * An earlier dispatch (Issue #72) built the read-only scaffold: the header
 * fields, Attachments (download/preview — no upload or removal), and the
 * Public Comments thread, plus the screen's loading/not-found/error states.
 * This dispatch adds the operational panel card (ui-spec.md §10's editable
 * table) between the ticket information card and Attachments, and
 * implements its Ticket Owner control — a `SelectField` of active IT Staff
 * and Administrators plus "Unassigned" (`fetchAssignableUsers`,
 * `client/src/staff/api.ts`), a Claim button shown only while unassigned,
 * and the save via `patchTicketOwner` (`client/src/tickets/api.ts`). IT
 * Priority and Status now live inside that same card too, but only as
 * relocated read-only badges — each still carries its own
 * `TODO(#72): editable in a later dispatch` comment marking where its own
 * dispatch replaces it with its interactive control. Internal Notes
 * (ui-spec.md §8) is also a later dispatch and is not present here at all.
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

  const { user } = useAuth();

  const [state, setState] = useState<DetailState>({ phase: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  // Ticket Owner select's option pool (ui-spec.md §10: "active IT Staff and
  // Administrators, plus Unassigned") — fetched once on mount, same
  // fetch-and-swallow-failure pattern StaffTicketQueueScreen.tsx already
  // uses for its own Owner filter. Unlike that filter (ui-spec.md §9,
  // IT_STAFF only), this control keeps BOTH roles `fetchAssignableUsers`
  // returns — ui-spec.md §10 asks for "active IT Staff and Administrators"
  // here, no role filter. A failed fetch just leaves the dropdown at
  // "Unassigned" only (e.g. an Administrator caller: this endpoint is
  // IT-Staff-only server-side, so an Administrator viewing this screen sees
  // an empty pool here — consistent with the several other write actions
  // this screen already denies them) — it must never break the rest of the
  // screen.
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);

  // Ticket Owner control's own inline save state (ui-spec.md §10: "Each
  // control shows its own inline busy state and a success tick on save; a
  // failed save restores the previous value ..."). Shared by both the
  // select and the Claim button since they're the same control with two
  // triggers. The select's displayed value is always derived from
  // `state.ticket.owner` (never a separate local "pending" value), so a
  // failed save "restores the previous value" simply by never having
  // applied the new one — no extra revert logic needed.
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerError, setOwnerError] = useState<string | undefined>(undefined);
  const [ownerSaved, setOwnerSaved] = useState(false);
  const ownerSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    fetchAssignableUsers()
      .then(setAssignableUsers)
      .catch(() => {});
  }, []);

  // Clears the pending "Saved" tick timeout on unmount, so it never fires
  // setState after this screen is gone.
  useEffect(() => {
    return () => {
      if (ownerSavedTimerRef.current) {
        clearTimeout(ownerSavedTimerRef.current);
      }
    };
  }, []);

  /**
   * "Unassigned" plus one option per active IT Staff/Administrator user
   * (ui-spec.md §10) — value is the sentinel or the user's id, stringified,
   * so it round-trips through `handleOwnerSelectChange` below exactly like
   * the queue's own Owner filter does for "unassigned"/"me"/an id
   * (StaffTicketQueueScreen.tsx).
   *
   * The select's `value` is always `state.ticket.owner`'s id (or the
   * "unassigned" sentinel), but `assignableUsers` may not contain that
   * owner — either because `fetchAssignableUsers` hasn't resolved yet, or
   * (for an Administrator viewer) because `GET /api/staff/assignable-users`
   * is IT-Staff-only server-side and always fails for them. A native
   * `<select>` whose `value` matches no `<option>` silently falls back to
   * displaying the first option ("Unassigned"), which would misrepresent
   * an actually-assigned ticket. So the current owner is always included,
   * synthesized from `state.ticket.owner` if it isn't already present.
   */
  const currentOwner = state.phase === "loaded" ? state.ticket.owner : null;
  const ownerOptions = useMemo<SelectOption[]>(() => {
    const options = [
      { value: UNASSIGNED_OWNER_VALUE, label: "Unassigned" },
      ...assignableUsers.map((assignable) => ({
        value: String(assignable.id),
        label: assignable.name,
      })),
    ];
    if (
      currentOwner &&
      !assignableUsers.some((assignable) => assignable.id === currentOwner.id)
    ) {
      options.push({
        value: String(currentOwner.id),
        label: currentOwner.name,
      });
    }
    return options;
  }, [assignableUsers, currentOwner]);

  function handleRetry() {
    setReloadToken((token) => token + 1);
  }

  function handleBack() {
    navigate("/staff/tickets");
  }

  function showOwnerSavedTick() {
    setOwnerSaved(true);
    if (ownerSavedTimerRef.current) clearTimeout(ownerSavedTimerRef.current);
    ownerSavedTimerRef.current = setTimeout(() => {
      setOwnerSaved(false);
    }, SAVED_TICK_DURATION_MS);
  }

  /**
   * Shared save path for both the select's onChange and the Claim button
   * (`PATCH /api/tickets/:id/owner`, api-spec.md §5.1). Updates
   * `state.ticket.owner` in place from the server's response on success —
   * same "no full re-fetch" convention as `TicketDetailScreen.tsx`'s
   * `handleAttachmentRemoved`/`handleAttachmentAdded` — and on failure
   * leaves `state.ticket.owner` untouched (which is also what the select is
   * bound to, so it "reverts" for free) while surfacing a field-level
   * error.
   */
  function saveOwner(nextOwnerId: number | null) {
    if (state.phase !== "loaded") return;
    setOwnerSaving(true);
    setOwnerError(undefined);

    patchTicketOwner(state.ticket.id, nextOwnerId)
      .then((updated) => {
        setState((previous) => {
          if (previous.phase !== "loaded") return previous;
          return {
            phase: "loaded",
            ticket: { ...previous.ticket, owner: updated.owner },
          };
        });
        showOwnerSavedTick();
      })
      .catch((error: unknown) => {
        setOwnerError(
          error instanceof InvalidOwnerError
            ? error.message
            : "Could not update the ticket owner. Please check your connection and try again.",
        );
      })
      .finally(() => {
        setOwnerSaving(false);
      });
  }

  function handleOwnerSelectChange(value: string) {
    if (state.phase !== "loaded") return;
    const currentValue = state.ticket.owner
      ? String(state.ticket.owner.id)
      : UNASSIGNED_OWNER_VALUE;
    if (value === currentValue) return;
    saveOwner(value === UNASSIGNED_OWNER_VALUE ? null : Number(value));
  }

  function handleClaim() {
    if (!user) return;
    saveOwner(user.id);
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
              <StaticField
                label="Related System"
                value={state.ticket.relatedSystem.name}
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

          {/* Operational panel (ui-spec.md §10: "one card, `--zen-pale`
              accent") — visually distinct from the read-only ticket
              information card above, same way that card's own fields use
              `--zen-readonly-bg` (ui-spec.md §10 intro: "Read-only and
              editable regions are visually separated"). IT Priority and
              Status were relocated here from that card as plain read-only
              badges for now (see their own TODO comments below); only
              Ticket Owner is interactive in this dispatch. */}
          <section className="zen-staff-detail__card zen-staff-detail__card--operations">
            <h2>Ticket Operations</h2>

            <div className="zen-staff-detail__grid">
              {/* TODO(#72): editable in a later dispatch — replace with the
                  IT Priority segmented control (ui-spec.md §10's editable
                  table: three values, saves on change). Now lives in the
                  operational panel card, still read-only. */}
              <StaticBadgeField label="IT Priority">
                <PriorityBadge
                  value={state.ticket.itPriority ?? ""}
                  variant="it"
                />
              </StaticBadgeField>

              {/* TODO(#72): editable in a later dispatch — replace with the
                  Status select limited to the transitions the current status
                  permits (ui-spec.md §10's editable table; server transition
                  matrix at api-spec.md §5.3). Now lives in the operational
                  panel card, still read-only. */}
              <StaticBadgeField label="Current Status">
                <StatusBadge value={state.ticket.status} />
              </StaticBadgeField>

              {/* Ticket Owner (ui-spec.md §10's editable table): a select of
                  active IT Staff and Administrators plus "Unassigned"
                  (fetchAssignableUsers), with a Claim button shown only
                  while unassigned. */}
              <div className="zen-staff-detail__owner-control">
                <div className="zen-staff-detail__owner-row">
                  <SelectField
                    id="staff-ticket-owner"
                    label="Ticket Owner"
                    value={
                      state.ticket.owner
                        ? String(state.ticket.owner.id)
                        : UNASSIGNED_OWNER_VALUE
                    }
                    onChange={handleOwnerSelectChange}
                    options={ownerOptions}
                    disabled={ownerSaving}
                    error={ownerError}
                  />
                  {state.ticket.owner === null && user && (
                    <Button
                      variant="secondary"
                      busy={ownerSaving}
                      onClick={handleClaim}
                    >
                      Claim
                    </Button>
                  )}
                </div>
                {ownerSaved && (
                  <span role="status" className="zen-staff-detail__save-tick">
                    <span aria-hidden="true">✓</span> Saved
                  </span>
                )}
              </div>
            </div>
          </section>

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
