import { useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RoleBadge } from "../components/RoleBadge";
import { useOptionalAuth } from "../auth/AuthContext";
import { logout as logoutRequest } from "../auth/api";
import "./UserBadge.css";

export interface UserBadgeProps {
  /** Invoked after choosing a menu action (e.g. to close a mobile menu). */
  onNavigate?: () => void;
}

/**
 * Authenticated user identity + menu (ui-spec.md §4.1). Shows the user's
 * name (real text, not just an avatar, so it's announced and findable by
 * search) and a `RoleBadge`, with a menu offering Change Password and
 * Logout.
 *
 * ui-spec.md §4.1: "Replaces RequesterBadge" — issue #70 deletes the Lab 2
 * Development Requester selector (`RequesterBadge`/`RequesterContext`/
 * `X-Requester-Id`, specification.md §7.4 item 8) entirely, so this is now
 * the only identity badge `AppShell` renders. This component renders
 * nothing (`null`) until a real authenticated user exists — e.g. Lab 2's
 * `AppShell.test.tsx`, which still mounts `AppShell` with no `AuthProvider`
 * in the tree.
 */
export function UserBadge({ onNavigate }: UserBadgeProps) {
  // Non-throwing: AppShell renders this unconditionally, and Lab 2's
  // AppShell.test.tsx mounts AppShell without an AuthProvider in the tree
  // (see useOptionalAuth's doc comment). This component simply renders
  // nothing in that case, same as it does whenever there's no
  // authenticated user yet.
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  function toggleMenu() {
    setOpen((value) => !value);
  }

  function handleChangePassword(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setOpen(false);
    onNavigate?.();
    navigate("/change-password");
  }

  function handleLogout(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (loggingOut) return;
    setOpen(false);
    onNavigate?.();
    setLoggingOut(true);

    // Clears client-held user state and redirects to /login regardless of
    // whether the server call itself succeeded (logoutRequest never
    // throws — see its own comment in ../auth/api.ts) — the browser Back
    // button or a directly re-typed protected URL must land on Login, not
    // a cached view (ui-spec.md §4.1), which only holds if AuthContext's
    // `user` is actually cleared here, not just navigated away from.
    logoutRequest().finally(() => {
      // Safe: reaching here requires `user` to be non-null (the early
      // return below guards every render before this handler could ever
      // fire), which only happens when `auth` itself is non-null.
      auth?.setUser(null);
      setLoggingOut(false);
      navigate("/login", { replace: true });
    });
  }

  if (!user) return null;

  return (
    <div className="zen-user-badge">
      <button
        type="button"
        className="zen-user-badge__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <span className="zen-user-badge__name">{user.name}</span>
        <RoleBadge value={user.role} />
        <span aria-hidden="true" className="zen-user-badge__caret">
          ▾
        </span>
      </button>

      {open && (
        <div role="menu" className="zen-user-badge__menu">
          <button
            type="button"
            role="menuitem"
            className="zen-user-badge__menu-item"
            onClick={handleChangePassword}
          >
            Change Password
          </button>
          <button
            type="button"
            role="menuitem"
            className="zen-user-badge__menu-item"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out…" : "Logout"}
          </button>
        </div>
      )}
    </div>
  );
}
