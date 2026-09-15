import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { RequesterBadge } from "./RequesterBadge";
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
// independently enforced server-side (specification.md §2), and — for IT
// Staff / Administrator — by `RequireRole` client-side once #71/#73 wrap
// their screens with it.
//
// `/staff/tickets` and `/admin/users` deliberately do not resolve to a
// built screen yet (#71, #73 build those) — exactly the same kind of known,
// documented gap #68 left for `/select-requester` (see App.tsx's own scope
// note). Getting the nav ITEM SET right per role is this issue's job;
// building the screens behind IT Staff's and Administrator's links is not.
const ROLE_NAV_LINKS: Record<Role, NavLink[]> = {
  REQUESTER: REQUESTER_NAV_LINKS,
  IT_STAFF: [{ to: "/staff/tickets", label: "Ticket Queue" }],
  ADMINISTRATOR: [{ to: "/admin/users", label: "User Management" }],
};

/**
 * Resolves which nav links to show. `role` is `undefined` in two real
 * cases, both pre-existing and out of this issue's scope to close:
 *   1. `AppShell` mounted with no `AuthProvider` in the tree at all —
 *      Lab 2's `client/tests/lab-02/AppShell.test.tsx` and
 *      `ui-style.test.tsx` do exactly this, and must keep passing
 *      unmodified (this issue does not touch Lab 2 test files).
 *   2. The real Requester ticket screens (My Tickets, Create Ticket,
 *      Ticket Detail), which still identify the caller via
 *      `RequesterContext`/`X-Requester-Id`, not `AuthContext` — #70's job,
 *      not this issue's (see App.tsx's scope note).
 * In both cases the caller is, today, always acting as a Requester (no
 * other role's screens exist to reach `AppShell` this way yet), so the
 * Requester nav is the correct and only honest fallback — never an empty
 * nav, which would regress Lab 2's still-passing assertions for no
 * authorization reason at all.
 */
function navLinksForRole(role: Role | undefined): NavLink[] {
  if (!role) return REQUESTER_NAV_LINKS;
  return ROLE_NAV_LINKS[role] ?? REQUESTER_NAV_LINKS;
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

          {/* ui-spec.md §4.1's UserBadge is rendered alongside, not in
              place of, RequesterBadge — see UserBadge.tsx's doc comment for
              why (#68 judgment call: the Requester flow still identifies
              itself via RequesterContext until #70 rewires it onto the
              session). UserBadge renders nothing until a real authenticated
              user exists, so this is a no-op on every screen #68 doesn't
              touch. */}
          <div className="zen-app-shell__requester zen-app-shell__requester--inline">
            <RequesterBadge />
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
              <RequesterBadge onNavigate={closeMenu} />
              <UserBadge onNavigate={closeMenu} />
            </div>
          </nav>
        )}
      </header>

      <main className="zen-app-shell__content">{children}</main>
    </div>
  );
}
