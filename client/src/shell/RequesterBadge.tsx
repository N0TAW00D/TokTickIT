import { useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useRequester } from "../requester/RequesterContext";
import "./RequesterBadge.css";

export interface RequesterBadgeProps {
  /** Invoked after choosing a menu action (e.g. to close a mobile menu). */
  onNavigate?: () => void;
}

/**
 * Current-Requester display + "Change Requester" menu (ui-spec.md §4).
 * The name is real text (not just an avatar) so it is announced and
 * findable by search.
 */
export function RequesterBadge({ onNavigate }: RequesterBadgeProps) {
  const { requesterName } = useRequester();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  function toggleMenu() {
    setOpen((value) => !value);
  }

  function handleChangeRequester(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setOpen(false);
    onNavigate?.();
    navigate("/select-requester");
  }

  return (
    <div className="zen-requester-badge">
      <button
        type="button"
        className="zen-requester-badge__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <span className="zen-requester-badge__name">
          {requesterName ?? "—"}
        </span>
        <span aria-hidden="true" className="zen-requester-badge__caret">
          ▾
        </span>
      </button>

      {open && (
        <div role="menu" className="zen-requester-badge__menu">
          <button
            type="button"
            role="menuitem"
            className="zen-requester-badge__menu-item"
            onClick={handleChangeRequester}
          >
            Change Requester
          </button>
        </div>
      )}
    </div>
  );
}
