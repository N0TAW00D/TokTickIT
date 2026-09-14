import { useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { TextInput } from "../components/TextInput";
import { ErrorState } from "../components/ErrorState";
import { useAuth } from "../auth/AuthContext";
import { login, LoginFailedError, LoginValidationError } from "../auth/api";
import "./LoginScreen.css";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormValues {
  email: string;
  password: string;
}

type FieldName = keyof FormValues;
const FIELD_ORDER: FieldName[] = ["email", "password"];
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_IDS: Record<FieldName, string> = {
  email: "login-email",
  password: "login-password",
};

/** Client-side mirror of validateLoginEmail/validateLoginPassword (server/src/validation/authFields.ts) — the server remains authoritative; this only avoids a round trip for the obvious cases. */
function validateField(name: FieldName, values: FormValues): string | undefined {
  switch (name) {
    case "email": {
      const trimmed = values.email.trim();
      return trimmed.length > 0 && EMAIL_PATTERN.test(trimmed)
        ? undefined
        : "Enter a valid email address.";
    }
    case "password":
      return values.password.length > 0 ? undefined : "Password is required.";
    default:
      return undefined;
  }
}

function validateAll(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const name of FIELD_ORDER) {
    const message = validateField(name, values);
    if (message) errors[name] = message;
  }
  return errors;
}

type SubmitState = { phase: "idle" } | { phase: "submitting" } | { phase: "error"; message: string };

/**
 * Login screen (ui-spec.md §5, `/login`). Public — no auth required to view
 * it, the opposite of every other screen in the app.
 */
export function LoginScreen() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  const [values, setValues] = useState<FormValues>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: "idle" });
  const submitLockRef = useRef(false);

  // Already signed in (e.g. a stale /login visit after login already
  // populated AuthContext in this same session) — go straight in rather
  // than showing the form again.
  if (user) {
    return <Navigate to={user.mustChangePassword ? "/change-password" : "/"} replace />;
  }

  function setValue<K extends FieldName>(name: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleBlur(name: FieldName) {
    return () => {
      const message = validateField(name, values);
      setFieldErrors((current) => ({ ...current, [name]: message }));
    };
  }

  function focusField(name: FieldName) {
    document.getElementById(FIELD_IDS[name])?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current) return;

    const errors = validateAll(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstInvalid = FIELD_ORDER.find((name) => errors[name]);
      if (firstInvalid) focusField(firstInvalid);
      return;
    }

    setFieldErrors({});
    submitLockRef.current = true;
    setSubmitState({ phase: "submitting" });

    login(values.email.trim(), values.password)
      .then((authUser) => {
        setUser(authUser);
        const redirectTo = authUser.mustChangePassword ? "/change-password" : "/";
        navigate(redirectTo, { replace: true });
      })
      .catch((error: unknown) => {
        if (error instanceof LoginValidationError) {
          // The server is the source of truth (BR-01): a field it rejects
          // that the client-side check let through still surfaces here,
          // same generic-message fallback pattern as CreateTicketScreen.
          const mapped: FieldErrors = {};
          for (const fieldError of error.fields) {
            if (fieldError.field === "email" || fieldError.field === "password") {
              mapped[fieldError.field] = fieldError.message;
            }
          }
          if (Object.keys(mapped).length > 0) {
            setFieldErrors(mapped);
            const firstInvalid = FIELD_ORDER.find((name) => mapped[name]);
            if (firstInvalid) focusField(firstInvalid);
            setSubmitState({ phase: "idle" });
            return;
          }
        }

        // BR-08/BR-38: LoginFailedError covers both wrong-credentials and
        // rate-limited — identical text either way (ui-spec.md §5), so
        // there is deliberately only one branch here, not two.
        const message =
          error instanceof LoginFailedError
            ? error.message
            : "We couldn't sign you in. Check your email and password and try again.";
        setSubmitState({ phase: "error", message });
      })
      .finally(() => {
        submitLockRef.current = false;
      });
  }

  const submitting = submitState.phase === "submitting";

  return (
    <div className="zen-login-screen">
      <header className="zen-login-screen__topbar">
        <span className="zen-login-screen__wordmark">⌚ TokTickIT</span>
      </header>

      <main className="zen-login-screen__main">
        <div className="zen-login-screen__card">
          <h1>Sign in</h1>

          {submitState.phase === "error" && <ErrorState message={submitState.message} />}

          <form onSubmit={handleSubmit} noValidate>
            <FormField id={FIELD_IDS.email} label="Email" required error={fieldErrors.email}>
              <TextInput
                type="email"
                autoComplete="username"
                readOnly={submitting}
                value={values.email}
                onChange={(event) => setValue("email", event.target.value)}
                onBlur={handleBlur("email")}
              />
            </FormField>

            <FormField id={FIELD_IDS.password} label="Password" required error={fieldErrors.password}>
              <TextInput
                type="password"
                autoComplete="current-password"
                readOnly={submitting}
                value={values.password}
                onChange={(event) => setValue("password", event.target.value)}
                onBlur={handleBlur("password")}
              />
            </FormField>

            {submitting && (
              <span role="status" className="zen-login-screen__busy-announcement">
                Signing in…
              </span>
            )}

            <Button type="submit" variant="primary" busy={submitting} className="zen-login-screen__submit">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
