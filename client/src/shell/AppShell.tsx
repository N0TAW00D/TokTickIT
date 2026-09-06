import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { RequesterBadge } from "./RequesterBadge";
import "./AppShell.css";

export interface AppShellProps {
  children: ReactNode;
}

const NAV_LINKS = [
  { to: "/tickets", label: "My Tickets" },
  { to: "/tickets/new", label: "Create Ticket" },
];

const MOBILE_MENU_ID = "zen-app-shell-mobile-menu";

/**
 * Application shell (ui-spec.md §4): identity + primary nav + current
 * Requester, present on every screen except Requester Selection. Collapses
 * to a hamburger menu below 768px.
 */
export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

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

          <div className="zen-app-shell__requester zen-app-shell__requester--inline">
            <RequesterBadge />
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
            </div>
          </nav>
        )}
      </header>

      <main className="zen-app-shell__content">{children}</main>
    </div>
  );
}
