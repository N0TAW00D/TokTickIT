import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "./Button";
import { ConfirmStatusChangeDialog } from "./ConfirmStatusChangeDialog";
import { ErrorState } from "./ErrorState";
import { FormField } from "./FormField";
import { SelectField, type SelectOption } from "./SelectField";
import { TextArea } from "./TextArea";
import { TextInput } from "./TextInput";
import { getActionStatusLabel } from "./ActionStatusBadge";
import {
  ActionWriteError,
  createAction,
  updateAction,
  type ActionStatus,
  type ActionTaken,
  type CreateActionInput,
  type UpdateActionInput,
} from "../tickets/actionsApi";
import {
  formatDateTime,
  fromBangkokInputValue,
  toBangkokInputValue,
} from "../tickets/formatDateTime";
import "./ActionTakenForm.css";

const LIMITS = {
  description: 2000,
  result: 2000,
  followUpNote: 1000,
  attachmentNotes: 500,
} as const;

/** Permitted next states (specification.md BR-09). */
const NEXT_STATUS: Record<ActionStatus, ActionStatus[]> = {
  PLANNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const CREATE_STATUSES: ActionStatus[] = ["PLANNED", "IN_PROGRESS", "COMPLETED"];

export interface AssigneeOption {
  id: number;
  name: string;
}

interface FormValues {
  actionAt: string;
  description: string;
  result: string;
  status: ActionStatus;
  assigneeId: string;
  followUpRequired: boolean;
  followUpNote: string;
  attachmentNotes: string;
}

type FieldName =
  | "actionAt"
  | "description"
  | "result"
  | "status"
  | "assignee"
  | "followUpNote"
  | "attachmentNotes";

type FieldErrors = Partial<Record<FieldName, string>>;

/** DOM order, used to focus the first invalid control. */
const FIELD_ORDER: FieldName[] = [
  "actionAt",
  "status",
  "assignee",
  "followUpNote",
  "description",
  "result",
  "attachmentNotes",
];

const FIELD_ID: Record<FieldName, string> = {
  actionAt: "action-form-action-at",
  assignee: "action-form-assignee",
  description: "action-form-description",
  result: "action-form-result",
  status: "action-form-status",
  followUpNote: "action-form-follow-up-note",
  attachmentNotes: "action-form-attachment-notes",
};

/** Server `fields[].field` names to this form's controls. */
const SERVER_FIELD: Record<string, FieldName> = {
  actionAt: "actionAt",
  description: "description",
  result: "result",
  status: "status",
  assigneeId: "assignee",
  assignee: "assignee",
  followUpNote: "followUpNote",
  followUpRequired: "followUpNote",
  attachmentNotes: "attachmentNotes",
};

type Callout =
  | { kind: "locked" }
  | { kind: "ticket-closed" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "invalid-transition" }
  | { kind: "idempotency" }
  | { kind: "validation-other" };

const CALLOUT_TEXT: Record<Callout["kind"], string> = {
  locked: "This action can no longer be edited.",
  "ticket-closed": "This ticket is closed.",
  forbidden: "You don't have permission to change Actions Taken.",
  "not-found": "This action or ticket no longer exists.",
  "invalid-transition":
    "That status change isn't allowed from this action's current status.",
  idempotency:
    "A different version of this action was already saved from this form. Reload the actions to check before adding it again.",
  "validation-other": "Please check the form and try again.",
};

function valuesFromAction(action: ActionTaken): FormValues {
  return {
    actionAt: toBangkokInputValue(action.actionAt),
    description: action.description,
    result: action.result ?? "",
    status: action.status,
    assigneeId: action.assignee ? String(action.assignee.id) : "",
    followUpRequired: action.followUpRequired,
    followUpNote: action.followUpNote ?? "",
    attachmentNotes: action.attachmentNotes ?? "",
  };
}

function emptyValues(): FormValues {
  return {
    actionAt: toBangkokInputValue(new Date()),
    description: "",
    result: "",
    status: "PLANNED",
    assigneeId: "",
    followUpRequired: false,
    followUpNote: "",
    attachmentNotes: "",
  };
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for browsers without `crypto.randomUUID`.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function validate(
  values: FormValues,
  ticketCreatedAt: string,
): FieldErrors {
  const errors: FieldErrors = {};

  const iso = fromBangkokInputValue(values.actionAt);
  if (!iso) {
    errors.actionAt = "Enter the date and time of the action.";
  } else if (new Date(iso).getTime() < new Date(ticketCreatedAt).getTime()) {
    errors.actionAt = "The action can't be earlier than the ticket was created.";
  } else if (values.status !== "PLANNED" && new Date(iso).getTime() > Date.now()) {
    errors.actionAt = "A future time is allowed only for a planned action.";
  }

  const description = values.description.trim();
  if (description.length === 0) {
    errors.description = "Enter a description.";
  } else if (description.length > LIMITS.description) {
    errors.description = `Description must be ${LIMITS.description} characters or fewer.`;
  }

  const result = values.result.trim();
  if (values.status === "COMPLETED" && result.length === 0) {
    errors.result = "Enter the result to complete this action.";
  } else if (result.length > LIMITS.result) {
    errors.result = `Result must be ${LIMITS.result} characters or fewer.`;
  }

  if (values.followUpRequired) {
    const note = values.followUpNote.trim();
    if (note.length === 0) {
      errors.followUpNote = "Enter a follow-up note.";
    } else if (note.length > LIMITS.followUpNote) {
      errors.followUpNote = `Follow-up note must be ${LIMITS.followUpNote} characters or fewer.`;
    }
  }

  if (values.attachmentNotes.trim().length > LIMITS.attachmentNotes) {
    errors.attachmentNotes = `Attachment notes must be ${LIMITS.attachmentNotes} characters or fewer.`;
  }

  return errors;
}

function buildCreateBody(
  values: FormValues,
  clientRequestId: string,
): CreateActionInput {
  const body: CreateActionInput = {
    description: values.description.trim(),
    actionAt: fromBangkokInputValue(values.actionAt) ?? undefined,
    status: values.status,
    followUpRequired: values.followUpRequired,
    clientRequestId,
  };
  const result = values.result.trim();
  if (result) body.result = result;
  if (values.assigneeId) body.assigneeId = Number(values.assigneeId);
  if (values.followUpRequired) body.followUpNote = values.followUpNote.trim();
  const attachmentNotes = values.attachmentNotes.trim();
  if (attachmentNotes) body.attachmentNotes = attachmentNotes;
  return body;
}

/** Only what differs from the version being edited, plus `version` (api-spec.md §2.4). */
function buildUpdateBody(
  values: FormValues,
  base: ActionTaken,
): UpdateActionInput {
  const before = valuesFromAction(base);
  const body: UpdateActionInput = { version: base.version };

  if (values.actionAt !== before.actionAt) {
    body.actionAt = fromBangkokInputValue(values.actionAt) ?? undefined;
  }
  if (values.description.trim() !== before.description) {
    body.description = values.description.trim();
  }
  if (values.result.trim() !== before.result.trim()) {
    body.result = values.result.trim() || null;
  }
  if (values.status !== before.status) body.status = values.status;
  if (values.assigneeId !== before.assigneeId) {
    body.assigneeId = values.assigneeId ? Number(values.assigneeId) : null;
  }
  if (values.followUpRequired !== before.followUpRequired) {
    body.followUpRequired = values.followUpRequired;
    if (values.followUpRequired) body.followUpNote = values.followUpNote.trim();
  } else if (
    values.followUpRequired &&
    values.followUpNote.trim() !== before.followUpNote.trim()
  ) {
    body.followUpNote = values.followUpNote.trim();
  }
  if (values.attachmentNotes.trim() !== before.attachmentNotes.trim()) {
    body.attachmentNotes = values.attachmentNotes.trim() || null;
  }
  return body;
}

function describeAssignee(action: ActionTaken): string {
  return action.assignee ? action.assignee.name : "Unassigned";
}

export interface ActionTakenFormProps {
  ticketId: number;
  ticketCreatedAt: string;
  /** The Action being edited; omitted to create. */
  action?: ActionTaken;
  performedByName: string;
  assignableUsers: AssigneeOption[];
  onCancel: () => void;
  onSaved: (saved: ActionTaken) => void;
  /** The list on screen is out of date (locked, stale, not found). */
  onReload: () => void;
  /** The Ticket itself is out of date (it was closed). */
  onTicketChanged: () => void;
}

/** Create / edit form for one Action Taken (ui-spec.md §5.1, §5.2): one clientRequestId per form (BR-35),
 * typed values survive failures (BR-36), edits carry `version`, STALE_UPDATE offers the latest. */
export function ActionTakenForm({
  ticketId,
  ticketCreatedAt,
  action,
  performedByName,
  assignableUsers,
  onCancel,
  onSaved,
  onReload,
  onTicketChanged,
}: ActionTakenFormProps) {
  const editing = action !== undefined;

  const [base, setBase] = useState<ActionTaken | undefined>(action);
  const [values, setValues] = useState<FormValues>(() =>
    action ? valuesFromAction(action) : emptyValues(),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [focusRequest, setFocusRequest] = useState<{ field: FieldName } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [stale, setStale] = useState<ActionTaken | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const submittingRef = useRef(false);
  const requestIdRef = useRef<string>(newRequestId());
  const calloutRef = useRef<HTMLDivElement>(null);
  const noteFocusRef = useRef(false);

  const readOnly =
    callout?.kind === "locked" || callout?.kind === "ticket-closed";

  // Focus moves to the first field when the form opens (ui-spec.md §5.1).
  useEffect(() => {
    document.getElementById(FIELD_ID.actionAt)?.focus();
  }, []);

  useEffect(() => {
    if (focusRequest) {
      document.getElementById(FIELD_ID[focusRequest.field])?.focus();
    }
  }, [focusRequest]);

  useEffect(() => {
    if (stale || callout) calloutRef.current?.focus();
  }, [stale, callout]);

  useEffect(() => {
    if (noteFocusRef.current && values.followUpRequired) {
      noteFocusRef.current = false;
      document.getElementById(FIELD_ID.followUpNote)?.focus();
    }
  }, [values.followUpRequired]);

  const statusOptions = useMemo<SelectOption[]>(() => {
    const statuses = base
      ? [base.status, ...NEXT_STATUS[base.status]]
      : CREATE_STATUSES;
    return statuses.map((status) => ({
      value: status,
      label: getActionStatusLabel(status),
    }));
  }, [base]);

  const assigneeOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [
      { value: "", label: "Unassigned" },
      ...assignableUsers.map((user) => ({
        value: String(user.id),
        label: user.name,
      })),
    ];
    const current = base?.assignee;
    if (current && !assignableUsers.some((user) => user.id === current.id)) {
      options.push({ value: String(current.id), label: current.name });
    }
    return options;
  }, [assignableUsers, base]);

  function setValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function clearError(field: FieldName) {
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function showFieldErrors(next: FieldErrors) {
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field]);
    if (first) setFocusRequest({ field: first });
  }

  function handleFollowUpToggle(checked: boolean) {
    if (checked) noteFocusRef.current = true;
    setValues((previous) => ({
      ...previous,
      followUpRequired: checked,
      // Turning the box off hides and clears the note (BR-06).
      followUpNote: checked ? previous.followUpNote : "",
    }));
    if (!checked) clearError("followUpNote");
  }

  async function send() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFailed(false);
    setCallout(null);
    setStale(null);
    try {
      let saved: ActionTaken;
      if (base) {
        saved = await updateAction(ticketId, base.id, buildUpdateBody(values, base));
      } else {
        saved = await createAction(
          ticketId,
          buildCreateBody(values, requestIdRef.current),
        );
      }
      onSaved(saved);
    } catch (error) {
      handleFailure(error);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setConfirmingCancel(false);
    }
  }

  function handleFailure(error: unknown) {
    if (!(error instanceof ActionWriteError) || error.kind === "failure") {
      setFailed(true);
      return;
    }
    switch (error.kind) {
      case "validation": {
        const next: FieldErrors = {};
        for (const entry of error.fields) {
          const field = SERVER_FIELD[entry.field];
          if (field && !next[field]) next[field] = entry.message;
        }
        if (Object.keys(next).length > 0) showFieldErrors(next);
        else setCallout({ kind: "validation-other" });
        return;
      }
      case "invalid-assignee":
        showFieldErrors({
          assignee:
            "That person can't be assigned. Choose an active IT Staff member.",
        });
        return;
      case "stale":
        if (error.current) setStale(error.current);
        else {
          setCallout({ kind: "locked" });
          onReload();
        }
        return;
      case "locked":
        setCallout({ kind: "locked" });
        onReload();
        return;
      case "ticket-closed":
        setCallout({ kind: "ticket-closed" });
        onTicketChanged();
        return;
      case "invalid-transition":
        setCallout({ kind: "invalid-transition" });
        onReload();
        return;
      case "not-found":
        setCallout({ kind: "not-found" });
        return;
      case "forbidden":
        setCallout({ kind: "forbidden" });
        return;
      case "idempotency":
        setCallout({ kind: "idempotency" });
        return;
    }
  }

  function handleSubmit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (submittingRef.current || readOnly) return;
    const found = validate(values, ticketCreatedAt);
    if (Object.keys(found).length > 0) {
      showFieldErrors(found);
      return;
    }
    setErrors({});
    if (base) {
      const body = buildUpdateBody(values, base);
      if (Object.keys(body).length === 1) {
        // Nothing changed: there is nothing to save (an empty change set is a 400).
        onCancel();
        return;
      }
      if (values.status === "CANCELLED" && base.status !== "CANCELLED") {
        setConfirmingCancel(true);
        return;
      }
    }
    void send();
  }

  /** "Use latest version (keep my edits)": adopt the new version, keep what was typed. */
  function useLatestVersion() {
    if (!stale || !base) return;
    const before = valuesFromAction(base);
    const latest = valuesFromAction(stale);
    setValues((previous) => {
      const merged = { ...previous };
      (Object.keys(latest) as (keyof FormValues)[]).forEach((key) => {
        if (previous[key] === before[key]) {
          (merged as Record<string, unknown>)[key] = latest[key];
        }
      });
      const permitted = [stale.status, ...NEXT_STATUS[stale.status]];
      if (!permitted.includes(merged.status)) merged.status = stale.status;
      return merged;
    });
    setBase(stale);
    setStale(null);
    setErrors({});
    if (NEXT_STATUS[stale.status].length === 0) {
      setCallout({ kind: "locked" });
      onReload();
    }
  }

  function describe(
    field: "description" | "result" | "followUpNote" | "attachmentNotes",
  ) {
    return {
      current: values[field].length,
      max: LIMITS[field],
    };
  }

  const resultRequired = values.status === "COMPLETED";
  const noteId = FIELD_ID.followUpNote;

  return (
    <form
      className="zen-action-form"
      aria-label={editing ? "Edit action" : "Add action"}
      noValidate
      onSubmit={handleSubmit}
    >
      <h3 className="zen-action-form__title">
        {editing ? "Edit action" : "Add action"}
      </h3>

      {stale && (
        <div
          ref={calloutRef}
          tabIndex={-1}
          role="alert"
          className="zen-action-form__callout zen-action-form__callout--warning"
        >
          <p>
            This action was changed by <strong>{stale.lastUpdatedBy?.name}</strong>{" "}
            at {formatDateTime(stale.updatedAt)}.
          </p>
          <Button type="button" variant="secondary" onClick={useLatestVersion}>
            Use latest version (keep my edits)
          </Button>
        </div>
      )}

      {callout && (
        <div
          ref={calloutRef}
          tabIndex={-1}
          role="alert"
          className="zen-action-form__callout"
        >
          <p>
            {CALLOUT_TEXT[callout.kind]}
            {callout.kind === "not-found" && (
              <>
                {" "}
                <Link to="/staff/tickets">Ticket Queue</Link>
              </>
            )}
          </p>
          {callout.kind === "idempotency" && (
            <Button type="button" variant="secondary" onClick={onReload}>
              Reload actions
            </Button>
          )}
        </div>
      )}

      <div className={stale ? "zen-action-form__with-latest" : undefined}>
        <div className="zen-action-form__grid">
          <FormField
            id={FIELD_ID.actionAt}
            label="Action date/time"
            required
            error={errors.actionAt}
            helperText="When the work was done, or is planned for. A future time is allowed only for a planned action."
          >
            <TextInput
              type="datetime-local"
              value={values.actionAt}
              readOnly={readOnly}
              onChange={(event) => {
                setValue("actionAt", event.target.value);
                clearError("actionAt");
              }}
            />
          </FormField>

          <SelectField
            id={FIELD_ID.status}
            label="Status"
            required
            value={values.status}
            options={statusOptions}
            disabled={readOnly || statusOptions.length <= 1}
            error={errors.status}
            onChange={(value) => {
              setValue("status", value as ActionStatus);
              clearError("status");
              clearError("result");
              clearError("actionAt");
            }}
          />

          <SelectField
            id={FIELD_ID.assignee}
            label="Assignee"
            value={values.assigneeId}
            options={assigneeOptions}
            disabled={readOnly}
            error={errors.assignee}
            onChange={(value) => {
              setValue("assigneeId", value);
              clearError("assignee");
            }}
          />

          <div className="zen-field zen-action-form__checkbox">
            <label htmlFor="action-form-follow-up">
              <input
                id="action-form-follow-up"
                type="checkbox"
                checked={values.followUpRequired}
                disabled={readOnly}
                aria-expanded={values.followUpRequired}
                aria-controls={noteId}
                onChange={(event) => handleFollowUpToggle(event.target.checked)}
              />{" "}
              Follow-up required?
            </label>
          </div>

          {values.followUpRequired && (
            <div className="zen-action-form__wide">
              <FormField
                id={noteId}
                label="Follow-up note"
                required
                error={errors.followUpNote}
                counter={describe("followUpNote")}
              >
                <TextArea
                  value={values.followUpNote}
                  readOnly={readOnly}
                  onChange={(event) => {
                    setValue("followUpNote", event.target.value);
                    clearError("followUpNote");
                  }}
                />
              </FormField>
            </div>
          )}
        </div>

        <div className="zen-field">
          <span id="action-form-performed-by-label" className="zen-field__label">
            Performed by
          </span>
          <div
            className="zen-action-form__static"
            aria-labelledby="action-form-performed-by-label"
          >
            {editing ? base?.performedBy?.name : performedByName}
          </div>
          <div className="zen-field__meta">
            <span className="zen-field__helper">Recorded automatically.</span>
          </div>
        </div>

        <FormField
          id={FIELD_ID.description}
          label="Description"
          required
          error={errors.description}
          counter={describe("description")}
        >
          <TextArea
            value={values.description}
            readOnly={readOnly}
            onChange={(event) => {
              setValue("description", event.target.value);
              clearError("description");
            }}
          />
        </FormField>

        <FormField
          id={FIELD_ID.result}
          label="Result"
          required={resultRequired}
          error={errors.result}
          helperText="What came of it. Required to complete the action."
          counter={describe("result")}
        >
          <TextArea
            value={values.result}
            readOnly={readOnly}
            onChange={(event) => {
              setValue("result", event.target.value);
              clearError("result");
            }}
          />
        </FormField>

        <FormField
          id={FIELD_ID.attachmentNotes}
          label="Attachment notes"
          error={errors.attachmentNotes}
          helperText="Which existing ticket attachment or file to look at. This does not upload a file."
          counter={describe("attachmentNotes")}
        >
          <TextArea
            value={values.attachmentNotes}
            readOnly={readOnly}
            onChange={(event) => {
              setValue("attachmentNotes", event.target.value);
              clearError("attachmentNotes");
            }}
          />
        </FormField>

        {stale && (
          <aside
            className="zen-action-form__latest"
            aria-label="Latest version"
          >
            <h4>Latest version</h4>
            <dl>
              <dt>Action date/time</dt>
              <dd>{formatDateTime(stale.actionAt)}</dd>
              <dt>Description</dt>
              <dd>{stale.description}</dd>
              <dt>Result</dt>
              <dd>{stale.result ?? "—"}</dd>
              <dt>Status</dt>
              <dd>{getActionStatusLabel(stale.status)}</dd>
              <dt>Assignee</dt>
              <dd>{describeAssignee(stale)}</dd>
              <dt>Follow-up</dt>
              <dd>
                {stale.followUpRequired
                  ? (stale.followUpNote ?? "Required")
                  : "Not required"}
              </dd>
              <dt>Attachment notes</dt>
              <dd>{stale.attachmentNotes ?? "—"}</dd>
            </dl>
          </aside>
        )}
      </div>

      {failed && (
        <ErrorState
          message="Something went wrong. Try again."
          onRetry={() => void send()}
        />
      )}

      <div className="zen-action-form__buttons">
        {!readOnly && (
          <Button id="action-form-save" type="submit" busy={submitting}>
            {submitting ? "Saving…" : "Save action"}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={submitting}
          onClick={onCancel}
        >
          {readOnly ? "Close" : "Cancel"}
        </Button>
      </div>

      {confirmingCancel && (
        <ConfirmStatusChangeDialog
          title="Cancel this action?"
          body="A cancelled action is read-only and can't be edited again."
          confirmLabel="Cancel action"
          busy={submitting}
          onCancel={() => {
            setConfirmingCancel(false);
            document.getElementById("action-form-save")?.focus();
          }}
          onConfirm={() => void send()}
        />
      )}
    </form>
  );
}
