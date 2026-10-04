import type { ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { RequireAuth } from "./RequireAuth";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import type { Role } from "../auth/api";

export interface RequireRoleProps {
  /** Roles permitted to view the wrapped screen (specification.md §4.1). */
  allowedRoles: Role[];
  children: ReactNode;
}

/** Each role's own landing route and its nav label (ui-spec.md §4.2), shared with AppShell's nav below. */
export const ROLE_LANDING: Record<Role, { path: string; label: string }> = {
  REQUESTER: { path: "/tickets", label: "My Tickets" },
  IT_STAFF: { path: "/staff/tickets", label: "Ticket Queue" },
  ADMINISTRATOR: { path: "/admin/users", label: "User Management" },
};

/**
 * The forbidden state (ui-spec.md §4.3): heading, one line of explanation,
 * and a link back to the caller's own landing page. Rendered IN PLACE OF
 * the wrapped screen — never alongside it — so the wrapped screen's own
 * data-fetching effects never mount (AC-18: "no request to a protected
 * endpoint is issued").
 */
function ForbiddenState({ role }: { role: Role }) {
  const landing = ROLE_LANDING[role];
  return (
    <EmptyState
      title="You don't have access to this page"
      description="Your account's role doesn't include this destination."
      action={
        <Link to={landing.path} className="zen-btn zen-btn--secondary">
          Go to {landing.label}
        </Link>
      }
    />
  );
}

function RoleGate({ allowedRoles, children }: RequireRoleProps) {
  // Safe to call unconditionally: RoleGate is only ever rendered as
  // RequireAuth's `children`, and RequireAuth renders its children solely
  // in the branch where `user` is confirmed non-null and
  // `mustChangePassword` is false (see RequireAuth.tsx) — so `user` here is
  // guaranteed non-null in every real render. The `!user` branch below is
  // defensive only, for a future refactor of RequireAuth that might loosen
  // that guarantee.
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <ForbiddenState role={user.role} />;
  }

  return <>{children}</>;
}

/**
 * Route guard for a role-restricted screen (issue #69; specification.md
 * FR-10, FR-12; ui-spec.md §4.3; AC-15, AC-17, AC-18). Wraps `RequireAuth`
 * rather than replacing it, so every unauthenticated-caller and
 * mandatory-password-change behaviour `RequireAuth` already provides (see
 * its own doc comment — issue #68) stays exactly as-is: no session -> the
 * shell does not render, the user is at Login; `mustChangePassword` is set
 * -> redirected to `/change-password`. This guard adds exactly one more
 * check on top, once `RequireAuth` has already confirmed an authenticated,
 * password-change-clear user: is that user's role in `allowedRoles`?
 *
 * - Role allowed -> renders `children` normally.
 * - Role NOT allowed -> renders the ui-spec.md §4.3 forbidden state instead
 *   of `children`. `children` is never mounted in this branch, so a
 *   forbidden screen's own data-fetching hooks never run (AC-18) — this is
 *   a property of NOT rendering the subtree, not a separate mechanism.
 *
 * This is purely client-side feedback (specification.md §2: "hiding a
 * button is not authorization"). The real control is server-side
 * `requireRole` (server/src/middleware/authContext.ts) — every protected
 * endpoint enforces the same matrix independently of what this component
 * renders.
 */
export function RequireRole({ allowedRoles, children }: RequireRoleProps) {
  return (
    <RequireAuth>
      <RoleGate allowedRoles={allowedRoles}>{children}</RoleGate>
    </RequireAuth>
  );
}
