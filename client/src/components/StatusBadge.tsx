import "./Badge.css";

/**
 * Known Current Status values (ui-spec.md §7.2). Lab 2 only ever produces
 * "NEW"; the note under §7.2 says Lab 3 adds more rows to the presentation
 * table below, not new component logic.
 */
export type StatusValue = "NEW";

export interface StatusBadgeProps {
  /**
   * Current Status to render. Typed as `StatusValue | (string & {})` rather
   * than the bare union so a status this build doesn't know about yet
   * (e.g. a Lab 3 value) still type-checks and renders via the fallback
   * below instead of being rejected at compile time.
   */
  value: StatusValue | (string & {});
}

interface StatusPresentation {
  label: string;
  className: string;
}

/**
 * Value → presentation table (ui-spec.md §7.2). A single object literal so
 * Lab 3's new status values are additional rows here, never a change to the
 * render logic below.
 */
const STATUS_PRESENTATION: Record<StatusValue, StatusPresentation> = {
  NEW: {
    label: "New",
    className: "zen-badge--status-new",
  },
};

function isKnownStatus(value: string): value is StatusValue {
  return value === "NEW";
}

/**
 * Fallback label for a value outside the known set: a title-cased rendering
 * of the raw value ("IN_PROGRESS" → "In Progress") rather than a generic
 * "Unknown" — see PriorityBadge's identical rationale. An empty/whitespace
 * value is the one case with nothing to show, so that falls back to the
 * literal word "Unknown".
 */
function humanizeUnknown(rawValue: string): string {
  const words = rawValue
    .trim()
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return "Unknown";
  }
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Current Status badge (ui-spec.md §7.2). Shared by My Tickets (§9) and
 * Ticket Detail (§10).
 *
 * Always renders the text label so status is never carried by color alone
 * (§12). A value outside the known set (only "NEW" in Lab 2) still renders
 * — neutral default style, humanized label — instead of crashing or
 * leaving a blank badge ("the component switches on value, default style
 * for unknown", §7.2).
 */
export function StatusBadge({ value }: StatusBadgeProps) {
  const presentation: StatusPresentation = isKnownStatus(value)
    ? STATUS_PRESENTATION[value]
    : {
        label: humanizeUnknown(value),
        className: "zen-badge--unknown",
      };

  return (
    <span className={`zen-badge ${presentation.className}`}>
      <span className="zen-badge__label">{presentation.label}</span>
    </span>
  );
}
