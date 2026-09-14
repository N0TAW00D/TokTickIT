import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { TextInput } from "../components/TextInput";
import { ErrorState } from "../components/ErrorState";
import { useAuth } from "../auth/AuthContext";
import {
  changePassword,
  ChangePasswordValidationError,
  logout as logoutRequest,
  WrongPasswordError,
} from "../auth/api";
import "./ChangePasswordScreen.css";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

interface FormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

type FieldName = keyof FormValues;
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_IDS: Record<FieldName, string> = {
  currentPassword: "change-password-current",
  newPassword: "change-password-new",
  confirmPassword: "change-password-confirm",
};

const INITIAL_VALUES: FormValues = { currentPassword: "", newPassword: "", confirmPassword: "" };

/** Client-side mirror of validation/passwordPolicy.ts's length rule. The same-as-current check has no client-side equivalent — the client never holds the current password's hash — and surfaces only from the server's field error (BR-07). */
function validateNewPassword(value: string): string | undefined {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH
    ? undefined
    : `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`;
}

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success" }
  | { phase: "error"; message: string };

const SUCCESS_REDIRECT_DELAY_MS = 1200;

/**
 * Change Password screen (ui-spec.md §6, `/change-password`). Mode is
 * driven by the authenticated caller's CURRENT `mustChangePassword` flag —
 * exactly how the server itself distinguishes the two paths (api-spec.md
 * §2.4) — not by how the screen was reached:
 *
 * - Forced (`mustChangePassword` true): no Current Password field, an
 *   explanatory banner, no Cancel — matches `RequireAuth` redirecting every
 *   other route back here until this succeeds.
 * - Voluntary (`mustChangePassword` false): Current Password required,
 *   Cancel returns to wherever the caller came from.
 */
export function ChangePasswordScreen() {
  const navigate = useNavigate();
  const { user, patchUser, setUser } = useAuth();
  // Captured ONCE, from the value `user.mustChangePassword` had when this
  // screen instance mounted — deliberately not read live on every render.
  // A successful forced-path submission calls patchUser({
  // mustChangePassword: false }) below, which would otherwise flip `forced`
  // to false mid-flight (still on this same screen, during the brief
  // "success" state, before the redirect fires) and swap this component
  // from its slim, chrome-less layout to the full AppShell layout for that
  // last moment — a jarring flash at best, and a hard crash in any host
  // that doesn't happen to wrap this screen in AppShell's other required
  // providers (as this repo's own AppShell-rendered RequesterBadge does)
  // at worst.
  const [forced] = useState(() => user?.mustChangePassword ?? false);

  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: "idle" });
  const submitLockRef = useRef(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (submitState.phase !== "success") return;
    const timer = setTimeout(() => {
      navigate("/", { replace: true });
    }, SUCCESS_REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [submitState.phase, navigate]);

  function setValue<K extends FieldName>(name: K, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleBlur(name: FieldName) {
    return () => {
      const message = fieldErrorFor(name, values, forced);
      setFieldErrors((current) => ({ ...current, [name]: message }));
    };
  }

  function focusField(name: FieldName) {
    document.getElementById(FIELD_IDS[name])?.focus();
  }

  function fieldErrorFor(name: FieldName, current: FormValues, isForced: boolean): string | undefined {
    switch (name) {
      case "currentPassword":
        if (isForced) return undefined;
        return current.currentPassword.length > 0 ? undefined : "Current password is required.";
      case "newPassword":
        return validateNewPassword(current.newPassword);
      case "confirmPassword":
        return current.confirmPassword === current.newPassword
          ? undefined
          : "Confirm new password must match new password.";
      default:
        return undefined;
    }
  }

  function validateAll(): FieldErrors {
    const order: FieldName[] = forced
      ? ["newPassword", "confirmPassword"]
      : ["currentPassword", "newPassword", "confirmPassword"];
    const errors: FieldErrors = {};
    for (const name of order) {
      const message = fieldErrorFor(name, values, forced);
      if (message) errors[name] = message;
    }
    return errors;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current) return;

    const errors = validateAll();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const order: FieldName[] = forced
        ? ["newPassword", "confirmPassword"]
        : ["currentPassword", "newPassword", "confirmPassword"];
      const firstInvalid = order.find((name) => errors[name]);
      if (firstInvalid) focusField(firstInvalid);
      return;
    }

    setFieldErrors({});
    submitLockRef.current = true;
    setSubmitState({ phase: "submitting" });

    const payload = forced
      ? { newPassword: values.newPassword, confirmPassword: values.confirmPassword }
      : {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
          confirmPassword: values.confirmPassword,
        };

    changePassword(payload)
      .then(() => {
        patchUser({ mustChangePassword: false });
        setSubmitState({ phase: "success" });
      })
      .catch((error: unknown) => {
        if (error instanceof WrongPasswordError) {
          setFieldErrors({ currentPassword: error.message });
          focusField("currentPassword");
          setSubmitState({ phase: "idle" });
          return;
        }

        if (error instanceof ChangePasswordValidationError) {
          const mapped: FieldErrors = {};
          const unmatched: string[] = [];
          for (const fieldError of error.fields) {
            if (
              fieldError.field === "currentPassword" ||
              fieldError.field === "newPassword" ||
              fieldError.field === "confirmPassword"
            ) {
              mapped[fieldError.field] = fieldError.message;
            } else {
              unmatched.push(fieldError.message);
            }
          }
          if (Object.keys(mapped).length > 0 || unmatched.length > 0) {
            setFieldErrors(mapped);
            const order: FieldName[] = forced
              ? ["newPassword", "confirmPassword"]
              : ["currentPassword", "newPassword", "confirmPassword"];
            const firstInvalid = order.find((name) => mapped[name]);
            if (firstInvalid) focusField(firstInvalid);
            setSubmitState(
              unmatched.length > 0 ? { phase: "error", message: unmatched.join(" ") } : { phase: "idle" },
            );
            return;
          }
        }

        setSubmitState({
          phase: "error",
          message: "Could not change the password. Please check your connection and try again.",
        });
      })
      .finally(() => {
        submitLockRef.current = false;
      });
  }

  function handleCancel() {
    navigate(-1);
  }

  // Forced mode's only escape route (see the comment on the slim topbar
  // below): a user who can't or doesn't want to complete the forced change
  // has no Cancel here, so Logout must stay reachable. Same pattern as
  // UserBadge's own handleLogout (../shell/UserBadge.tsx) — clears
  // client-held user state and redirects to /login regardless of whether
  // the server call itself succeeded (logoutRequest never throws).
  function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    logoutRequest().finally(() => {
      setUser(null);
      setLoggingOut(false);
      navigate("/login", { replace: true });
    });
  }

  const submitting = submitState.phase === "submitting";
  const success = submitState.phase === "success";

  const form = (
    <div className="zen-change-password__card">
      <h1>Change password</h1>

      {forced && (
        <div role="status" className="zen-change-password__banner">
          Choose a new password before continuing.
        </div>
      )}

      {success ? (
        <div role="status" className="zen-change-password__success">
          <span className="zen-change-password__success-icon" aria-hidden="true">
            ✓
          </span>{" "}
          Password changed.
        </div>
      ) : (
        <>
          <p className="zen-change-password__rules">
            At least {PASSWORD_MIN_LENGTH} characters. Must be different from your current password.
          </p>

          {submitState.phase === "error" && <ErrorState message={submitState.message} />}

          <form onSubmit={handleSubmit} noValidate>
            {!forced && (
              <FormField
                id={FIELD_IDS.currentPassword}
                label="Current password"
                required
                error={fieldErrors.currentPassword}
              >
                <TextInput
                  type="password"
                  autoComplete="current-password"
                  readOnly={submitting}
                  value={values.currentPassword}
                  onChange={(event) => setValue("currentPassword", event.target.value)}
                  onBlur={handleBlur("currentPassword")}
                />
              </FormField>
            )}

            <FormField id={FIELD_IDS.newPassword} label="New password" required error={fieldErrors.newPassword}>
              <TextInput
                type="password"
                autoComplete="new-password"
                readOnly={submitting}
                value={values.newPassword}
                onChange={(event) => setValue("newPassword", event.target.value)}
                onBlur={handleBlur("newPassword")}
              />
            </FormField>

            <FormField
              id={FIELD_IDS.confirmPassword}
              label="Confirm new password"
              required
              error={fieldErrors.confirmPassword}
            >
              <TextInput
                type="password"
                autoComplete="new-password"
                readOnly={submitting}
                value={values.confirmPassword}
                onChange={(event) => setValue("confirmPassword", event.target.value)}
                onBlur={handleBlur("confirmPassword")}
              />
            </FormField>

            {submitting && (
              <span role="status" className="zen-change-password__busy-announcement">
                Saving…
              </span>
            )}

            <div className="zen-change-password__actions">
              {!forced && (
                <Button variant="secondary" type="button" onClick={handleCancel} disabled={submitting}>
                  Cancel
                </Button>
              )}
              <Button type="submit" variant="primary" busy={submitting}>
                {submitting ? "Saving…" : "Save password"}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );

  // Forced mode is reached while every other route redirects here
  // (RequireAuth) — the shell's own nav/UserBadge would just be dead links
  // in that state, so it renders the same slim, wordmark-only layout the
  // Login screen uses instead of AppShell (not full AppShell: that would
  // also re-introduce UserBadge's own "Change Password" menu item, which is
  // exactly the screen already showing). But a user who can't or doesn't
  // want to complete the forced change — wrong new password twice, changed
  // their mind about which account — still needs a way out, so this slim
  // bar carries a standalone Logout button (UserBadge's exact
  // logout/redirect pattern, just not behind a menu). Voluntary mode is
  // reached FROM the shell (UserBadge menu), so it keeps the shell — and
  // UserBadge's own Logout — around it.
  if (forced) {
    return (
      <div className="zen-change-password-screen">
        <header className="zen-change-password-screen__topbar">
          <span className="zen-change-password-screen__wordmark">⌚ TokTickIT</span>
          <button
            type="button"
            className="zen-change-password-screen__logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out…" : "Logout"}
          </button>
        </header>
        <main className="zen-change-password-screen__main">{form}</main>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="zen-change-password-screen__voluntary">{form}</div>
    </AppShell>
  );
}
