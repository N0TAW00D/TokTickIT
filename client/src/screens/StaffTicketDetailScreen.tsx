import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { PriorityBadge } from "../components/PriorityBadge";
import { getStatusLabel, type StatusValue } from "../components/StatusBadge";
import { AttachmentList } from "../components/AttachmentList";
import { ImagePreviewDialog } from "../components/ImagePreviewDialog";
import { ConfirmStatusChangeDialog } from "../components/ConfirmStatusChangeDialog";
import { MessageThread } from "../components/MessageThread";
import { SelectField, type SelectOption } from "../components/SelectField";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "../components/SegmentedControl";
import { useAuth } from "../auth/AuthContext";
import { fetchAssignableUsers, type AssignableUser } from "../staff/api";
import {
  AttachmentRemovedError,
  downloadAttachment,
  fetchComments,
  fetchTicketDetail,
  fetchTicketNotes,
  InvalidOwnerError,
  patchTicketItPriority,
  patchTicketOwner,
  patchTicketStatus,
  postComment,
  postTicketNote,
  StatusTransitionConflictError,
  TicketNotFoundError,
  type RequestedPriority,
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
 * IT Priority segmented control's three options (ui-spec.md §10). Labels
 * match `PriorityBadge`'s own LOW/MEDIUM/HIGH presentation table
 * (`PriorityBadge.tsx`) so the segmented control's labels never drift from
 * the badge shown elsewhere for the same values.
 */
const IT_PRIORITY_OPTIONS: SegmentedControlOption[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

/**
 * Status transition matrix (specification.md §5.1) — mirrors the server's
 * own `TICKET_STATUS_TRANSITIONS` (`server/src/routes/tickets.ts`) exactly,
 * so the Status select never offers a destination the server would reject
 * as `409 INVALID_TRANSITION` (ui-spec.md §10: "listing only the
 * transitions §5.1 permits"). `CANCELLED` is terminal — an empty array,
 * not an absent key, so a lookup here never needs a separate "unknown
 * status" branch.
 */
const STATUS_TRANSITIONS: Record<StatusValue, StatusValue[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CANCELLED: [],
};

/**
 * Destinations that require the confirm dialog before saving
 * (specification.md §5.1's notes column: "Closing/Reopening/cancelling
 * requires confirmation in the UI"; ui-spec.md §10: "Close, Reopen and
 * Cancel open a confirm dialog first"). Every other destination saves
 * immediately on select-change, same as Owner/IT Priority.
 */
const STATUS_CONFIRM_REQUIRED = new Set<string>([
  "CLOSED",
  "REOPENED",
  "CANCELLED",
]);

/**
 * Confirm dialog copy per destination status (ui-spec.md §10 doesn't
 * dictate exact wording for these three, only that a dialog appears —
 * `STATUS_CONFIRM_REQUIRED`'s three keys, kept in sync with it).
 */
const STATUS_CONFIRM_COPY: Record<
  string,
  { title: string; body: string; confirmLabel: string }
> = {
  CLOSED: {
    title: "Close this ticket?",
    body: "The requester will see this ticket as Closed. It can be reopened later if the issue comes back.",
    confirmLabel: "Close ticket",
  },
  REOPENED: {
    title: "Reopen this ticket?",
    body: "This moves the ticket back into an active state so work on it can continue.",
    confirmLabel: "Reopen ticket",
  },
  CANCELLED: {
    title: "Cancel this ticket?",
    body: "This action cannot be undone — a cancelled ticket can't be reopened or moved to any other status.",
    confirmLabel: "Cancel ticket",
  },
};

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
 * A later dispatch added the operational panel card (ui-spec.md §10's
 * editable table) between the ticket information card and Attachments, and
 * its Ticket Owner control — a `SelectField` of active IT Staff and
 * Administrators plus "Unassigned" (`fetchAssignableUsers`,
 * `client/src/staff/api.ts`), a Claim button shown only while unassigned,
 * and the save via `patchTicketOwner` (`client/src/tickets/api.ts`). This
 * dispatch added IT Priority's control — a `SegmentedControl` of the three
 * priority values, saving via `patchTicketItPriority`
 * (`client/src/tickets/api.ts`); both IT_STAFF and ADMINISTRATOR may use
 * it (api-spec.md §5.2), so unlike Ticket Owner/Status there's no
 * role-based disabling here. This dispatch adds the last of the three
 * controls: Status, a `SelectField` listing only the destinations
 * `STATUS_TRANSITIONS` (a client-side copy of the server's own
 * `TICKET_STATUS_TRANSITIONS`, `server/src/routes/tickets.ts`) permits from
 * the current status, saving via `patchTicketStatus`
 * (`client/src/tickets/api.ts`). Selecting CLOSED/REOPENED/CANCELLED opens
 * `ConfirmStatusChangeDialog` first (ui-spec.md §10); every other
 * destination saves immediately. A `409` (`StatusTransitionConflictError`)
 * closes that dialog if open and renders a page-level conflict banner
 * (`statusConflictMessage`) instead of a field-level error — same "the
 * record moved on, refresh" pattern as `TicketDetailScreen.tsx`'s own
 * `conflictMessage`. This dispatch adds the last piece, the Internal Notes
 * thread (ui-spec.md §8/§10) — a second `MessageThread`, `variant="internal"`,
 * rendered directly after the Public Comments one, wired to
 * `fetchTicketNotes`/`postTicketNote` (`client/src/tickets/api.ts`) exactly
 * as Public Comments is wired to `fetchComments`/`postComment`. Both
 * IT_STAFF and ADMINISTRATOR can read notes (`GET
 * /api/tickets/:id/notes` allows both), but only IT_STAFF can post them —
 * `MessageThread` needs no role-awareness for this: an Administrator's
 * composer submit simply fails via `postEntry`'s existing generic failure
 * path (403), the same way an Administrator posting a Public Comment
 * already fails without any special-case UI.
 *
 * IT_STAFF-only in the UI (App.tsx wraps this route with
 * `RequireRole allowedRoles={["IT_STAFF"]}`, same as `/staff/tickets`) —
 * ui-spec.md §4.2's role-specific navigation table gives Administrator
 * exactly one destination (User Management), and this screen is titled
 * "Screen: IT Staff Ticket Detail" and appears in no Administrator nav.
 * That `GET /api/tickets/:id` also serves Administrator reads
 * (api-spec.md §5) is a fact about the read API, not a grant of this UI
 * route — see App.tsx's route comment for the same distinction. Several
 * write actions on this screen are IT_STAFF-only server-side regardless.
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
 * `onDownload`/`onPreview` plus `showRemove={false}` (omitting `onRemove`
 * alone would NOT hide the button — `AttachmentList`'s `ActiveRow` renders
 * Remove unconditionally by default; `showRemove` is the actual mechanism,
 * see `AttachmentList`'s own doc comment), and replicates just the
 * download-fetch-and-save and preview-lightbox wiring `AttachmentSection`
 * owns internally (`handleDownload`/`handlePreview` below mirror its logic
 * exactly).
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

  // IT Priority control's own inline save state (ui-spec.md §10) — same
  // shape/convention as the Ticket Owner state above, just for
  // `itPriority`. The segmented control's displayed value is always
  // derived from `state.ticket.itPriority` (never a separate local
  // "pending" value), so a failed save "restores the previous value" the
  // same way: by never having applied the new one.
  const [itPrioritySaving, setItPrioritySaving] = useState(false);
  const [itPriorityError, setItPriorityError] = useState<string | undefined>(
    undefined,
  );
  const [itPrioritySaved, setItPrioritySaved] = useState(false);
  const itPrioritySavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Status control's own inline save state (ui-spec.md §10) — same
  // shape/convention as Ticket Owner/IT Priority above, plus two things
  // neither of those needs: `pendingStatus` (the destination awaiting
  // confirmation in the dialog, or null when no dialog is open) and
  // `statusConflictMessage` (a rejected 409 transition, rendered as a
  // page-level banner rather than a field-level error — same pattern as
  // `TicketDetailScreen.tsx`'s own `conflictMessage`/`RequesterResolvedConflictError`
  // handling, since it's the same "the record moved on, refresh" concept).
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | undefined>(
    undefined,
  );
  const [statusSaved, setStatusSaved] = useState(false);
  const statusSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [statusConflictMessage, setStatusConflictMessage] = useState<
    string | null
  >(null);

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

  // Clears the pending "Saved" tick timeouts on unmount, so they never fire
  // setState after this screen is gone.
  useEffect(() => {
    return () => {
      if (ownerSavedTimerRef.current) {
        clearTimeout(ownerSavedTimerRef.current);
      }
      if (itPrioritySavedTimerRef.current) {
        clearTimeout(itPrioritySavedTimerRef.current);
      }
      if (statusSavedTimerRef.current) {
        clearTimeout(statusSavedTimerRef.current);
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

  /**
   * The current status plus only the destinations `STATUS_TRANSITIONS`
   * permits from it (ui-spec.md §10: "listing only the transitions §5.1
   * permits from the current status"). The current status is always
   * included first so the select's `value` always matches one of its own
   * `<option>`s — same reasoning as `ownerOptions` always including the
   * current owner above. For `CANCELLED` (terminal), `STATUS_TRANSITIONS`
   * contributes nothing, so this is a single-option list containing only
   * the current status — handled by disabling the select below rather than
   * rendering a dropdown with no real choice in it.
   */
  const currentStatus =
    state.phase === "loaded" ? (state.ticket.status as StatusValue) : null;
  const statusOptions = useMemo<SelectOption[]>(() => {
    if (!currentStatus) return [];
    const permitted = STATUS_TRANSITIONS[currentStatus] ?? [];
    return [
      { value: currentStatus, label: getStatusLabel(currentStatus) },
      ...permitted.map((next) => ({ value: next, label: getStatusLabel(next) })),
    ];
  }, [currentStatus]);

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

  function showItPrioritySavedTick() {
    setItPrioritySaved(true);
    if (itPrioritySavedTimerRef.current) {
      clearTimeout(itPrioritySavedTimerRef.current);
    }
    itPrioritySavedTimerRef.current = setTimeout(() => {
      setItPrioritySaved(false);
    }, SAVED_TICK_DURATION_MS);
  }

  /**
   * IT Priority segmented control's save path (`PATCH
   * /api/tickets/:id/it-priority`, api-spec.md §5.2) — same
   * update-in-place-on-success/leave-untouched-on-failure convention as
   * `saveOwner` above. Both IT Staff and Administrator can call this route
   * (api-spec.md §5.2's one staff-write route Administrator isn't blocked
   * from), so unlike `saveOwner`/Status there's no role check here and a
   * failure is always the generic "something unexpected happened" message
   * — `patchTicketItPriority` never raises a more specific error to show
   * instead.
   */
  function saveItPriority(nextItPriority: RequestedPriority) {
    if (state.phase !== "loaded") return;
    setItPrioritySaving(true);
    setItPriorityError(undefined);

    patchTicketItPriority(state.ticket.id, nextItPriority)
      .then((updated) => {
        setState((previous) => {
          if (previous.phase !== "loaded") return previous;
          return {
            phase: "loaded",
            ticket: { ...previous.ticket, itPriority: updated.itPriority },
          };
        });
        showItPrioritySavedTick();
      })
      .catch(() => {
        setItPriorityError(
          "Could not update the IT priority. Please check your connection and try again.",
        );
      })
      .finally(() => {
        setItPrioritySaving(false);
      });
  }

  function handleItPriorityChange(value: string) {
    if (state.phase !== "loaded") return;
    if (value === state.ticket.itPriority) return;
    saveItPriority(value as RequestedPriority);
  }

  function showStatusSavedTick() {
    setStatusSaved(true);
    if (statusSavedTimerRef.current) clearTimeout(statusSavedTimerRef.current);
    statusSavedTimerRef.current = setTimeout(() => {
      setStatusSaved(false);
    }, SAVED_TICK_DURATION_MS);
  }

  /**
   * Status control's save path (`PATCH /api/tickets/:id/status`,
   * api-spec.md §5.3) — shared by both the direct select-change path (most
   * destinations) and the confirm dialog's Confirm button (Close/Reopen/
   * Cancel). Same update-in-place-on-success convention as
   * `saveOwner`/`saveItPriority`, plus the one behaviour those two don't
   * need: a `409` (`StatusTransitionConflictError`) closes the confirm
   * dialog (if one was open) and renders the page-level conflict banner
   * instead of a field-level error (ui-spec.md §10's frozen conflict copy,
   * `STATUS_TRANSITION_CONFLICT_MESSAGE`).
   */
  function saveStatus(nextStatus: string) {
    if (state.phase !== "loaded") return;
    setStatusSaving(true);
    setStatusError(undefined);

    patchTicketStatus(state.ticket.id, nextStatus)
      .then((updated) => {
        setState((previous) => {
          if (previous.phase !== "loaded") return previous;
          return {
            phase: "loaded",
            ticket: { ...previous.ticket, status: updated.status },
          };
        });
        setPendingStatus(null);
        showStatusSavedTick();
      })
      .catch((error: unknown) => {
        if (error instanceof StatusTransitionConflictError) {
          setPendingStatus(null);
          setStatusConflictMessage(error.message);
          return;
        }
        setStatusError(
          "Could not update the ticket status. Please check your connection and try again.",
        );
      })
      .finally(() => {
        setStatusSaving(false);
      });
  }

  /**
   * Select's onChange: Close/Reopen/Cancel destinations open the confirm
   * dialog instead of saving immediately (ui-spec.md §10); every other
   * destination saves right away, same as Owner/IT Priority.
   */
  function handleStatusSelectChange(value: string) {
    if (state.phase !== "loaded") return;
    if (value === state.ticket.status) return;
    if (STATUS_CONFIRM_REQUIRED.has(value)) {
      setStatusError(undefined);
      setPendingStatus(value);
      return;
    }
    saveStatus(value);
  }

  function handleStatusConfirm() {
    if (pendingStatus) saveStatus(pendingStatus);
  }

  function handleStatusCancelConfirm() {
    if (statusSaving) return;
    setPendingStatus(null);
    setStatusError(undefined);
  }

  function handleStatusConflictRefresh() {
    setStatusConflictMessage(null);
    handleRetry();
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

      {/* Status transition conflict (ui-spec.md §10: "A rejected transition
          (409) renders the conflict state") — same page-level banner
          pattern as TicketDetailScreen.tsx's own conflictMessage for
          RequesterResolvedConflictError, since it's the same "the record
          moved on since you loaded it, refresh" concept. */}
      {statusConflictMessage && (
        <div role="alert" className="zen-staff-detail__conflict-banner">
          <span>{statusConflictMessage}</span>
          <Button variant="secondary" onClick={handleStatusConflictRefresh}>
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
              editable regions are visually separated"). All three controls
              — Ticket Owner, IT Priority and Status — are interactive. */}
          <section className="zen-staff-detail__card zen-staff-detail__card--operations">
            <h2>Ticket Operations</h2>

            <div className="zen-staff-detail__grid">
              {/* IT Priority (ui-spec.md §10's editable table): a
                  segmented control of the three priority values, saving on
                  change. Both IT Staff and Administrator may use it
                  (api-spec.md §5.2) — no role-based disabling here, unlike
                  Ticket Owner/Status. */}
              <div className="zen-staff-detail__it-priority-control">
                <SegmentedControl
                  id="staff-it-priority"
                  label="IT Priority"
                  value={state.ticket.itPriority ?? ""}
                  onChange={handleItPriorityChange}
                  options={IT_PRIORITY_OPTIONS}
                  disabled={itPrioritySaving}
                  error={itPriorityError}
                />
                {itPrioritySaved && (
                  <span role="status" className="zen-staff-detail__save-tick">
                    <span aria-hidden="true">✓</span> Saved
                  </span>
                )}
              </div>

              {/* Status (ui-spec.md §10's editable table): a select
                  listing only the transitions STATUS_TRANSITIONS permits
                  from the current status. CANCELLED is terminal, so
                  `statusOptions` there is just the current value — the
                  select is disabled rather than offered as a real choice
                  with nothing in it. Close/Reopen/Cancel open the confirm
                  dialog below instead of saving immediately. */}
              <div className="zen-staff-detail__status-control">
                <SelectField
                  id="staff-ticket-status"
                  label="Current Status"
                  value={state.ticket.status}
                  onChange={handleStatusSelectChange}
                  options={statusOptions}
                  disabled={statusSaving || statusOptions.length <= 1}
                  error={statusError}
                />
                {statusSaved && (
                  <span role="status" className="zen-staff-detail__save-tick">
                    <span aria-hidden="true">✓</span> Saved
                  </span>
                )}
              </div>

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
              showRemove={false}
            />

            {downloadError && (
              <div role="alert" className="zen-staff-detail__download-error">
                <span aria-hidden="true">⚠</span> {downloadError}
              </div>
            )}
          </section>

          {/* ui-spec.md §8/§10: Public Comments card, then Internal Notes
              card, in that order — "the internal card second." */}
          <MessageThread
            variant="public"
            fetchEntries={() => fetchComments(state.ticket.id)}
            postEntry={(body) => postComment(state.ticket.id, body)}
          />

          <MessageThread
            variant="internal"
            fetchEntries={() => fetchTicketNotes(state.ticket.id)}
            postEntry={(body) => postTicketNote(state.ticket.id, body)}
          />
        </>
      )}

      {preview && IMAGE_MIME_TYPES.has(preview.mimeType) && (
        <ImagePreviewDialog attachment={preview} onClose={handlePreviewClose} />
      )}

      {pendingStatus && STATUS_CONFIRM_COPY[pendingStatus] && (
        <ConfirmStatusChangeDialog
          title={STATUS_CONFIRM_COPY[pendingStatus].title}
          body={STATUS_CONFIRM_COPY[pendingStatus].body}
          confirmLabel={STATUS_CONFIRM_COPY[pendingStatus].confirmLabel}
          busy={statusSaving}
          errorMessage={statusError}
          onCancel={handleStatusCancelConfirm}
          onConfirm={handleStatusConfirm}
        />
      )}
    </AppShell>
  );
}
