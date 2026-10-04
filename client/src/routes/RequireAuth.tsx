import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { fetchCurrentUser } from "../auth/api";
import { useAuth } from "../auth/AuthContext";
import { LoadingState } from "../components/LoadingState";

type GuardStatus = "checking" | "authenticated" | "unauthenticated";

const CHANGE_PASSWORD_PATH = "/change-password";

/**
 * Route guard for every authenticated screen (specification.md FR-06,
 * FR-09; api-spec.md §1.5; ui-spec.md §4.3). This is issue #68's whole
 * client-side enforcement: "there is no session, so you're at Login" (plus
 * the mandatory password-change redirect FR-06 requires) — role-aware
 * navigation and a "forbidden" state for an authenticated-but-wrong-role
 * caller are issue #69's job, not built here.
 *
 * - No confirmed user yet -> `GET /api/auth/me`. A match hydrates
 *   AuthContext; a failure (401, network error) sends the caller to
 *   `/login`, never a cached view (mirrors RequireRequester's pattern for
 *   `requesterName`, ../requester/RequesterContext.tsx).
 * - `mustChangePassword` is true and the caller isn't already on
 *   `/change-password` -> redirected there, matching the server's own gate
 *   (api-spec.md §1.5) so the client never bothers requesting a route the
 *   server would refuse anyway.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState<GuardStatus>(user ? "authenticated" : "checking");
  // One verdict per mount, the same guard used by RequireRequester and for
  // the same reason: without it, a logout's own setUser(null) would re-run
  // this effect and could stomp an already-decided verdict.
  const resolvedRef = useRef(user !== null);

  useEffect(() => {
    if (resolvedRef.current) return;

    let cancelled = false;

    fetchCurrentUser()
      .then((fetchedUser) => {
        if (cancelled) return;
        resolvedRef.current = true;
        setUser(fetchedUser);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        resolvedRef.current = true;
        setStatus("unauthenticated");
      });

    return () => {
      cancelled = true;
    };
  }, [setUser]);

  if (status === "checking") {
    return <LoadingState />;
  }

  if (status === "unauthenticated" || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return <>{children}</>;
}
