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
 * search — same rationale `RequesterBadge`'s own comment gives) and a
 * `RoleBadge`, with a menu offering Change Password and Logout.
 *
 * ui-spec.md §4.1 says this "Replaces RequesterBadge"; issue #68 renders it
 * ALONGSIDE `RequesterBadge` in `AppShell` instead (judgment call — see
 * AppShell.tsx's comment): the Requester ticket screens still identify the
 * caller via `X-Requester-Id`/`RequesterContext` until #70 rewires them
 * onto the session and deletes the selector (specification.md §7.4 item
 * 8), so removing `RequesterBadge` now would leave those screens with no
 * way to see/change which Requester they're acting as. This component
 * renders nothing (`null`) until a real authenticated user exists, so on
 * every screen #68 doesn't touch it is invisible today, exactly as if it
 * had never been added.
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
