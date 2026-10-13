import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { RoleBadge } from "./RoleBadge";
import { ActionStatusBadge, getActionStatusLabel } from "./ActionStatusBadge";
import { FollowUpTag } from "./FollowUpTag";
import { ActionTakenForm, type AssigneeOption } from "./ActionTakenForm";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { ActionTaken } from "../tickets/actionsApi";
import { formatDateTime, formatDateTimeWithYear } from "../tickets/formatDateTime";
import "./ActionsTakenCard.css";

const SUCCESS_DURATION_MS = 4000;

type Mode = { kind: "none" } | { kind: "create" } | { kind: "edit"; id: number };

export interface ActionsTakenCardProps {
  ticketId: number;
  ticketNumber: string;
  ticketStatus: string;
  ticketCreatedAt: string;
  /** `"unavailable"`: the list answered 404, so there is nothing to show or add to. */
  actions: ActionTaken[] | "loading" | "error" | "unavailable";
  assignableUsers: AssigneeOption[];
  currentUserName: string;
  /** Re-read the list (after a write, a conflict or a Retry). */
  onReload: () => void;
  /** Re-read the Ticket (it was closed while a form was open). */
  onTicketChanged: () => void;
}

function isTerminal(action: ActionTaken): boolean {
  return action.status === "COMPLETED" || action.status === "CANCELLED";
}

/** Static, read-only detail of one Action (ui-spec.md §5.1 "View mode"). */
function ActionDetails({ action }: { action: ActionTaken }) {
  const rows: [string, ReactNode][] = [
    ["Action date/time", formatDateTimeWithYear(action.actionAt)],
    ["Description", action.description],
    ["Result", action.result ?? "—"],
    ["Status", getActionStatusLabel(action.status)],
    ["Performed by", action.performedBy?.name ?? "—"],
    ["Assignee", action.assignee?.name ?? "Unassigned"],
    ["Follow-up required", action.followUpRequired ? "Yes" : "No"],
    ["Follow-up note", action.followUpNote ?? "—"],
    [
      "Attachment notes",
      action.attachmentNotes ? `Look for: ${action.attachmentNotes}` : "—",
    ],
    ["Logged at", action.createdAt ? formatDateTimeWithYear(action.createdAt) : "—"],
    [
      "Last updated by",
      action.lastUpdatedBy
        ? `${action.lastUpdatedBy.name} · ${formatDateTimeWithYear(action.updatedAt)}`
        : "—",
    ],
  ];
  return (
    <div className="zen-actions__details">
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="zen-actions__detail">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {isTerminal(action) && (
        <p className="zen-actions__terminal-note">
          {action.status === "COMPLETED"
            ? "Completed actions are read-only."
            : "Cancelled actions are read-only."}
        </p>
      )}
    </div>
  );
}

function PerformedBy({ action }: { action: ActionTaken }) {
  return (
    <>
      <span>{action.performedBy?.name}</span>
      {action.performedBy?.role === "ADMINISTRATOR" && (
        <>
          {" "}
          <RoleBadge value="ADMINISTRATOR" />
        </>
      )}
      {action.assignee && (
        <div className="zen-actions__assignee">→ {action.assignee.name}</div>
      )}
    </>
  );
}

/**
 * Actions Taken card on the IT Staff / Administrator Ticket Detail
 * (lab-04/ui-spec.md §5.1, §5.2): header, table (>= 768 px) or stacked cards,
 * inline View, and the Add / Edit form. The list lives in the screen so the
 * resolution checklist reads the same rows; this card asks the screen to
 * re-read it through `onReload`.
 */
export function ActionsTakenCard({
  ticketId,
  ticketNumber,
  ticketStatus,
  ticketCreatedAt,
  actions,
  assignableUsers,
  currentUserName,
  onReload,
  onTicketChanged,
}: ActionsTakenCardProps) {
  const wide = useMediaQuery("(min-width: 768px)");
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [viewing, setViewing] = useState<Set<number>>(new Set());
  const [savedNotice, setSavedNotice] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreFocusRef = useRef<string | null>(null);

  const ticketClosed = ticketStatus === "CLOSED" || ticketStatus === "CANCELLED";
  const loaded = Array.isArray(actions);
  const formOpen = mode.kind !== "none";

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Returns focus to the control that opened the form once it closes.
  useEffect(() => {
    if (mode.kind === "none" && restoreFocusRef.current) {
      document.getElementById(restoreFocusRef.current)?.focus();
      restoreFocusRef.current = null;
    }
  }, [mode]);

  function closeForm(focusId: string) {
    restoreFocusRef.current = focusId;
    setMode({ kind: "none" });
  }

  function handleSaved() {
    const focusId =
      mode.kind === "edit" ? `action-edit-${mode.id}` : "actions-add";
    closeForm(focusId);
    setSavedNotice(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => setSavedNotice(false),
      SUCCESS_DURATION_MS,
    );
    onReload();
  }

  function toggleView(id: number) {
    setViewing((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function rowButtons(action: ActionTaken) {
    const when = formatDateTime(action.actionAt);
    const open = viewing.has(action.id);
    return (
      <div className="zen-actions__buttons">
        <Button
          variant="secondary"
          aria-label={`View action from ${when}`}
          aria-expanded={open}
          onClick={() => toggleView(action.id)}
        >
          View
        </Button>
        {!isTerminal(action) && !ticketClosed && (
          <Button
            id={`action-edit-${action.id}`}
            variant="secondary"
            aria-label={`Edit action from ${when}`}
            disabled={formOpen}
            onClick={() => setMode({ kind: "edit", id: action.id })}
          >
            Edit
          </Button>
        )}
      </div>
    );
  }

  const editing =
    mode.kind === "edit" && loaded
      ? actions.find((action) => action.id === mode.id)
      : undefined;

  return (
    <section
      id="actions-taken"
      tabIndex={-1}
      className="zen-staff-detail__card zen-actions"
      aria-labelledby="actions-taken-heading"
    >
      <div className="zen-actions__header">
        <div>
          <h2 id="actions-taken-heading">
            {loaded ? `Actions Taken (${actions.length})` : "Actions Taken"}
          </h2>
          <p className="zen-actions__shared">Visible to the requester</p>
        </div>
        {loaded && !ticketClosed && !formOpen && (
          <Button
            id="actions-add"
            variant="primary"
            onClick={() => setMode({ kind: "create" })}
          >
            Add action
          </Button>
        )}
      </div>

      {loaded && ticketClosed && (
        <p className="zen-actions__closed">
          This ticket is closed. Actions Taken are read-only.
        </p>
      )}

      {savedNotice && (
        <p role="status" className="zen-actions__saved">
          <span aria-hidden="true">✓</span> Action saved.
        </p>
      )}

      {actions === "loading" && <LoadingState label="Loading actions…" />}

      {actions === "unavailable" && (
        <p className="zen-actions__closed">
          Actions Taken aren&apos;t available for this ticket.
        </p>
      )}

      {actions === "error" && (
        <ErrorState
          message="Something went wrong. Try again."
          onRetry={onReload}
        />
      )}

      {mode.kind === "create" && (
        <ActionTakenForm
          key="create"
          ticketId={ticketId}
          ticketCreatedAt={ticketCreatedAt}
          performedByName={currentUserName}
          assignableUsers={assignableUsers}
          onCancel={() => closeForm("actions-add")}
          onSaved={handleSaved}
          onReload={onReload}
          onTicketChanged={onTicketChanged}
        />
      )}

      {mode.kind === "edit" && editing && (
        <ActionTakenForm
          key={`edit-${mode.id}`}
          ticketId={ticketId}
          ticketCreatedAt={ticketCreatedAt}
          action={editing}
          performedByName={currentUserName}
          assignableUsers={assignableUsers}
          onCancel={() => closeForm(`action-edit-${mode.id}`)}
          onSaved={handleSaved}
          onReload={onReload}
          onTicketChanged={onTicketChanged}
        />
      )}

      {loaded && actions.length === 0 && (
        <EmptyState title="No actions recorded yet." />
      )}

      {loaded && actions.length > 0 && wide && (
        <div className="zen-actions__table-wrap">
          <table className="zen-actions__table">
            <caption className="zen-actions__caption">
              Actions taken on {ticketNumber}
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Result</th>
                <th scope="col">Performed by</th>
                <th scope="col">Status</th>
                <th scope="col">Follow-up</th>
                <th scope="col">
                  <span className="zen-staff-detail__sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <Fragment key={action.id}>
                  <tr>
                    <td>{formatDateTime(action.actionAt)}</td>
                    <td>
                      <span
                        className="zen-actions__clamp"
                        title={action.description}
                      >
                        {action.description}
                      </span>
                    </td>
                    <td>
                      <span
                        className="zen-actions__clamp"
                        title={action.result ?? undefined}
                      >
                        {action.result}
                      </span>
                    </td>
                    <td>
                      <PerformedBy action={action} />
                    </td>
                    <td>
                      <ActionStatusBadge value={action.status} />
                    </td>
                    <td>{action.followUpRequired && <FollowUpTag />}</td>
                    <td>{rowButtons(action)}</td>
                  </tr>
                  {viewing.has(action.id) && (
                    <tr className="zen-actions__detail-row">
                      <td colSpan={7}>
                        <ActionDetails action={action} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loaded && actions.length > 0 && !wide && (
        <ul
          className="zen-actions__cards"
          aria-label={`Actions taken on ${ticketNumber}`}
        >
          {actions.map((action) => (
            <li key={action.id} className="zen-actions__item">
              <div className="zen-actions__item-head">
                <span>{formatDateTime(action.actionAt)}</span>
                <ActionStatusBadge value={action.status} />
              </div>
              <p className="zen-actions__clamp" title={action.description}>
                {action.description}
              </p>
              {action.result && (
                <p className="zen-actions__clamp" title={action.result}>
                  {action.result}
                </p>
              )}
              <div>
                <PerformedBy action={action} />
              </div>
              {action.followUpRequired && <FollowUpTag />}
              {rowButtons(action)}
              {viewing.has(action.id) && <ActionDetails action={action} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
