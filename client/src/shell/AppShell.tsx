import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { UserBadge } from "./UserBadge";
import { useOptionalAuth } from "../auth/AuthContext";
import type { Role } from "../auth/api";
import "./AppShell.css";

export interface AppShellProps {
  children: ReactNode;
}

interface NavLink {
  to: string;
  label: string;
}

// Requester's nav destinations (ui-spec.md §4.2), also the fallback when no
// authenticated user is known yet — see navLinksForRole's doc comment below
// for why that fallback is Requester, not empty.
const REQUESTER_NAV_LINKS: NavLink[] = [
  { to: "/tickets", label: "My Tickets" },
  { to: "/tickets/new", label: "Create Ticket" },
];

// Role-specific navigation (issue #69; specification.md FR-12; ui-spec.md
// §4.2's table). A role's list holds ONLY that role's permitted
// destinations — not rendered-and-disabled, simply absent (ui-spec.md
// §4.2: "A destination a role may not reach is not rendered"). This is
// feedback, not the security control: every one of these routes is
// independently enforced server-side (specification.md §2), and — for
// Requester / IT Staff / Administrator — by `RequireRole` client-side once
// each role's screens are wrapped with it.
//
// `/staff/tickets` and `/admin/users` deliberately do not resolve to a
// built screen yet (#71, #73 build those) — a known, documented gap.
// Getting the nav ITEM SET right per role is this issue's job; building the
// screens behind IT Staff's and Administrator's links is not.
const ROLE_NAV_LINKS: Record<Role, NavLink[]> = {
  REQUESTER: REQUESTER_NAV_LINKS,
  IT_STAFF: [{ to: "/staff/tickets", label: "Ticket Queue" }],
  ADMINISTRATOR: [{ to: "/admin/users", label: "User Management" }],
};

/**
 * Resolves which nav links to show. `role` is `undefined` when `AppShell`
 * is mounted with no `AuthProvider` in the tree at all — Lab 2's
 * `client/tests/lab-02/AppShell.test.tsx` and `ui-style.test.tsx` do
 * exactly this, and must keep passing unmodified. The real app
 * (`src/App.tsx`) always wraps `AppShell` in `AuthProvider`, and every
 * screen that reaches it is now gated by `RequireRole`, so this fallback
 * only ever fires in that legacy no-provider test context — never in
 * production. Requester nav is the fallback (not an empty nav) so those
 * Lab 2 assertions keep passing for no authorization reason at all.
 */
function navLinksForRole(role: Role | undefined): NavLink[] {
  if (!role) return REQUESTER_NAV_LINKS;
  return ROLE_NAV_LINKS[role] ?? REQUESTER_NAV_LINKS;
}

/**
 * A role's own landing route (ui-spec.md §5: "Success: brief success
 * state, then redirect to the role's landing page") — always that role's
 * FIRST nav destination, the same single source of truth `navLinksForRole`
 * already resolves for the nav itself, so the landing route and the nav's
 * first link can never drift apart. Used by `RoleLandingRedirect`
 * (`../routes/RoleLandingRedirect.tsx`) for the post-login "/" redirect.
 */
export function landingPathForRole(role: Role | undefined): string {
  return navLinksForRole(role)[0].to;
}

const MOBILE_MENU_ID = "zen-app-shell-mobile-menu";

/**
 * Application shell (ui-spec.md §4): identity + primary nav + current
 * Requester, present on every screen except Requester Selection. Collapses
 * to a hamburger menu below 768px.
 */
export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // Non-throwing, same as UserBadge (../auth/AuthContext.tsx's
  // useOptionalAuth doc comment) — AppShell is exercised without an
  // AuthProvider by Lab 2's own test files (see navLinksForRole above).
  const auth = useOptionalAuth();
  const NAV_LINKS = navLinksForRole(auth?.user?.role);

  function isActive(to: string) {
    // "My Tickets" should read active only on the list itself, not on
    // /tickets/new or /tickets/:id which also start with "/tickets".
    return location.pathname === to;
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="zen-app-shell">
      <header className="zen-app-shell__header">
        <div className="zen-app-shell__header-inner">
          <Link to="/tickets" className="zen-app-shell__wordmark">
            ⌚ TokTickIT
          </Link>

          <nav
            className="zen-app-shell__nav zen-app-shell__nav--inline"
            aria-label="Primary"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="zen-app-shell__nav-link"
                aria-current={isActive(link.to) ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* ui-spec.md §4.1: UserBadge replaces the Lab 2 RequesterBadge
              (deleted, #70). It renders nothing until a real authenticated
              user exists — a no-op on any screen reached without a
              session. */}
          <div className="zen-app-shell__requester zen-app-shell__requester--inline">
            <UserBadge />
          </div>

          <button
            type="button"
            className="zen-app-shell__hamburger"
            aria-expanded={menuOpen}
            aria-controls={MOBILE_MENU_ID}
            aria-label="Menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            ☰
          </button>
        </div>

        {menuOpen && (
          <nav
            id={MOBILE_MENU_ID}
            className="zen-app-shell__mobile-menu"
            aria-label="Primary"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="zen-app-shell__nav-link"
                aria-current={isActive(link.to) ? "page" : undefined}
                onClick={closeMenu}
              >
                {link.label}
              </Link>
            ))}
            <div className="zen-app-shell__requester zen-app-shell__requester--mobile">
              <UserBadge onNavigate={closeMenu} />
            </div>
          </nav>
        )}
      </header>

      <main className="zen-app-shell__content">{children}</main>
    </div>
  );
}
