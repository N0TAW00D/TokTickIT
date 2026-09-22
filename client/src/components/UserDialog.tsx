import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./Button";
import { FormField } from "./FormField";
import { TextInput } from "./TextInput";
import { SelectField, type SelectOption } from "./SelectField";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../auth/api";
import {
  createUser,
  updateUser,
  setUserInitialPassword,
  EmailInUseError,
  SelfDeactivationError,
  LastAdminError,
  UserValidationError,
  type AdminUser,
  type UserFieldError,
} from "../users/api";
import "./UserDialog.css";

/** The two non-`"none"` `DialogMode` variants (UserManagementScreen.tsx) — this component never sees `{ kind: "none" }`, since the screen only mounts it otherwise. */
export type UserDialogMode = { kind: "create" } | { kind: "edit"; user: AdminUser };

export interface UserDialogProps {
  mode: UserDialogMode;
  /** Esc / Cancel button — the dialog does not close itself, so the caller can restore focus to the trigger (ui-spec.md §13). */
  onCancel: () => void;
  /** A successful create, or a successful edit Save — NOT the separate initial-password reset, which stays open on success. The caller calls `refetch()` and closes. */
  onSaved: () => void;
}

const ROLE_OPTIONS: SelectOption[] = [
  { value: "REQUESTER", label: "Requester" },
  { value: "IT_STAFF", label: "IT Staff" },
  { value: "ADMINISTRATOR", label: "Administrator" },
];

const GENERIC_SAVE_ERROR =
  "Could not save this user. Please check your connection and try again.";
const GENERIC_PASSWORD_ERROR =
  "Could not set the password. Please check your connection and try again.";

/** Focusable elements inside the dialog, in DOM order, for the Tab trap — same idiom as `ConfirmStatusChangeDialog.tsx`'s `getFocusable`, widened to form controls since this dialog is a form, not just two buttons. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])',
    ),
  );
}

function findFieldMessage(
  fields: UserFieldError[],
  name: string,
): string | undefined {
  return fields.find((field) => field.field === name)?.message;
}

/**
 * Create/Edit dialog for Administrator User Management (ui-spec.md §11).
 * One component parameterized by `mode` rather than two dialogs, since the
 * fields overlap almost entirely — edit mode simply omits the create-only
 * Initial password field and adds a separate, structurally distinct
 * "Set new initial password" section below the main Save action (so a
 * password reset can never happen by accident while editing a name, per
 * ui-spec.md §11).
 *
 * Same modal shell as `ConfirmStatusChangeDialog.tsx`: `role="dialog"`,
 * `aria-modal`, `aria-labelledby`, Esc-to-close, a Tab focus trap, and
 * initial focus moved into the dialog on mount. The screen (not this
 * component) restores focus to whichever button opened it, since that
 * decision — and the ref it needs — lives with the trigger, not the dialog.
 */
export function UserDialog({ mode, onCancel, onSaved }: UserDialogProps) {
  const { user: currentUser } = useAuth();
  const isEdit = mode.kind === "edit";
  const editingUser = mode.kind === "edit" ? mode.user : null;
  const isEditingSelf =
    editingUser !== null && currentUser !== null && currentUser.id === editingUser.id;

  const [name, setName] = useState(editingUser?.name ?? "");
  const [email, setEmail] = useState(editingUser?.email ?? "");
  const [role, setRole] = useState<string>(editingUser?.role ?? ROLE_OPTIONS[0].value);
  const [isActive, setIsActive] = useState(editingUser?.isActive ?? true);
  const [initialPassword, setInitialPassword] = useState("");

  const [fieldErrors, setFieldErrors] = useState<UserFieldError[]>([]);
  const [banner, setBanner] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Separate state for the "Set new initial password" section (edit mode
  // only) — its own request, its own busy/success/error, entirely
  // independent of the main form's Save above (ui-spec.md §11).
  const [resetPassword, setResetPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | undefined>(undefined);
  const [resetFieldError, setResetFieldError] = useState<string | undefined>(undefined);
  const [resetSuccess, setResetSuccess] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "zen-user-dialog-title";

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled])")
      ?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Blocked while either request is in flight, same convention as
      // `ConfirmStatusChangeDialog.tsx` — closing mid-request would abandon
      // a pending create/update/password-reset call.
      if (busy || resetBusy) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
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
  }, [busy, resetBusy, onCancel]);

  function fieldError(name: string): string | undefined {
    return findFieldMessage(fieldErrors, name);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBanner(undefined);
    setFieldErrors([]);
    setBusy(true);

    try {
      if (mode.kind === "create") {
        await createUser({
          name,
          email,
          role: role as Role,
          isActive,
          initialPassword,
        });
      } else {
        await updateUser(mode.user.id, {
          name,
          email,
          role: role as Role,
          isActive,
        });
      }
      onSaved();
    } catch (error) {
      if (error instanceof UserValidationError) {
        setFieldErrors(error.fields);
      } else if (error instanceof EmailInUseError) {
        // Field-level on Email (ui-spec.md §11), not a banner — unlike the
        // other two guard-rails below.
        setFieldErrors([{ field: "email", message: error.message }]);
      } else if (error instanceof SelfDeactivationError) {
        // Fallback for the disabled-checkbox pre-emption below — defense in
        // depth, in case the 409 is reached some other way.
        setBanner(error.message);
      } else if (error instanceof LastAdminError) {
        // Cannot be pre-empted client-side — the dialog doesn't know how
        // many active Administrators exist.
        setBanner(error.message);
      } else {
        setBanner(GENERIC_SAVE_ERROR);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword() {
    if (!editingUser) return;
    setResetError(undefined);
    setResetFieldError(undefined);
    setResetSuccess(false);
    setResetBusy(true);

    try {
      await setUserInitialPassword(editingUser.id, resetPassword);
      setResetSuccess(true);
      setResetPassword("");
    } catch (error) {
      if (error instanceof UserValidationError) {
        setResetFieldError(
          findFieldMessage(error.fields, "initialPassword") ??
            "Enter a valid password.",
        );
      } else {
        setResetError(GENERIC_PASSWORD_ERROR);
      }
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="zen-user-dialog__overlay">
      <div
        ref={dialogRef}
        className="zen-user-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{isEdit ? "Edit user" : "New user"}</h2>

        {banner && (
          <div role="alert" className="zen-user-dialog__error">
            {banner}
          </div>
        )}

        <form onSubmit={handleSubmit} className="zen-user-dialog__form" noValidate>
          <FormField id="user-dialog-name" label="Name" required error={fieldError("name")}>
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </FormField>

          <FormField id="user-dialog-email" label="Email" required error={fieldError("email")}>
            <TextInput
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
          </FormField>

          <SelectField
            id="user-dialog-role"
            label="Role"
            value={role}
            onChange={setRole}
            options={ROLE_OPTIONS}
            required
            error={fieldError("role")}
            disabled={busy}
          />

          <div className="zen-field zen-user-dialog__checkbox-field">
            <label htmlFor="user-dialog-active" className="zen-user-dialog__checkbox-label">
              <input
                type="checkbox"
                id="user-dialog-active"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={busy || isEditingSelf}
                aria-describedby={
                  isEditingSelf ? "user-dialog-active-helper" : undefined
                }
              />
              Active
            </label>
            {isEditingSelf && (
              <p id="user-dialog-active-helper" className="zen-field__helper">
                You can&apos;t deactivate your own account.
              </p>
            )}
            {fieldError("isActive") && (
              <div role="alert" className="zen-field__error">
                {fieldError("isActive")}
              </div>
            )}
          </div>

          {mode.kind === "create" && (
            <FormField
              id="user-dialog-password"
              label="Initial password"
              required
              error={fieldError("initialPassword")}
              helperText="The user must change this the first time they sign in."
            >
              <TextInput
                type="password"
                autoComplete="new-password"
                value={initialPassword}
                onChange={(event) => setInitialPassword(event.target.value)}
                disabled={busy}
              />
            </FormField>
          )}

          <div className="zen-user-dialog__actions">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={busy || resetBusy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy} disabled={resetBusy}>
              Save
            </Button>
          </div>
        </form>

        {isEdit && (
          <div className="zen-user-dialog__password-section">
            <h3>Set new initial password</h3>

            {resetError && (
              <div role="alert" className="zen-user-dialog__error">
                {resetError}
              </div>
            )}

            <FormField
              id="user-dialog-reset-password"
              label="New initial password"
              required
              error={resetFieldError}
            >
              <TextInput
                type="password"
                autoComplete="new-password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                disabled={resetBusy || busy}
              />
            </FormField>

            <Button
              type="button"
              variant="secondary"
              busy={resetBusy}
              disabled={busy}
              onClick={handleSetPassword}
            >
              Set password
            </Button>

            {resetSuccess && (
              <p role="status" className="zen-user-dialog__reset-success">
                Password updated.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
