import { Navigate } from "react-router-dom";
import { RequireAuth } from "./RequireAuth";
import { useAuth } from "../auth/AuthContext";
import { landingPathForRole } from "../shell/AppShell";

/**
 * The `/` route's element (`App.tsx`). Real bug fix, not a refactor: `/`
 * previously `Navigate`d unconditionally to `/tickets` (Requester's own
 * screen), so any IT Staff or Administrator landing on `/` — including
 * immediately after a normal, successful login, since `LoginScreen`
 * navigates to `/` on success — was sent straight into the Requester-only
 * route's forbidden state instead of their own landing page. ui-spec.md §5
 * requires "redirect to the role's landing page" after login; this is what
 * makes that literally true for every role, not just Requester.
 *
 * `RequireAuth` still does its own job first (no session -> `/login`;
 * `mustChangePassword` -> `/change-password`) exactly as before — this
 * only replaces what happens once a session IS confirmed and no forced
 * change is pending.
 */
export function RoleLandingRedirect() {
  return (
    <RequireAuth>
      <RoleLanding />
    </RequireAuth>
  );
}

function RoleLanding() {
  const { user } = useAuth();
  return <Navigate to={landingPathForRole(user?.role)} replace />;
}
