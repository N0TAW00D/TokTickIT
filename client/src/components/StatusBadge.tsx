import "./Badge.css";

/**
 * Known Current Status values — the eight `TicketStatus` enum values
 * (lab-03/ui-spec.md §3.1; server/prisma/schema.prisma). Lab 2 only ever
 * produced "NEW"; Lab 3 adds the remaining seven rows to the presentation
 * table below, not new component logic.
 */
export type StatusValue =
  | "NEW"
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_FOR_REQUESTER"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED"
  | "CANCELLED";

export interface StatusBadgeProps {
  /**
   * Current Status to render. Typed as `StatusValue | (string & {})` rather
   * than the bare union so a status this build doesn't know about yet
   * still type-checks and renders via the fallback below instead of being
   * rejected at compile time.
   */
  value: StatusValue | (string & {});
}

interface StatusPresentation {
  label: string;
  className: string;
}

/**
 * Value → presentation table (lab-03/ui-spec.md §3.1). A single object
 * literal so a future status value is an additional row here, never a
 * change to the render logic below.
 */
const STATUS_PRESENTATION: Record<StatusValue, StatusPresentation> = {
  NEW: {
    label: "New",
    className: "zen-badge--status-new",
  },
  OPEN: {
    label: "Open",
    className: "zen-badge--status-open",
  },
  IN_PROGRESS: {
    label: "In Progress",
    className: "zen-badge--status-in-progress",
  },
  WAITING_FOR_REQUESTER: {
    label: "Waiting for Requester",
    className: "zen-badge--status-waiting-for-requester",
  },
  RESOLVED: {
    label: "Resolved",
    className: "zen-badge--status-resolved",
  },
  CLOSED: {
    label: "Closed",
    className: "zen-badge--status-closed",
  },
  REOPENED: {
    label: "Reopened",
    className: "zen-badge--status-reopened",
  },
  CANCELLED: {
    label: "Cancelled",
    className: "zen-badge--status-cancelled",
  },
};

function isKnownStatus(value: string): value is StatusValue {
  return Object.prototype.hasOwnProperty.call(STATUS_PRESENTATION, value);
}

/**
 * Fallback label for a value outside the known set: a title-cased rendering
 * of the raw value ("SOME_STATUS" → "Some Status") rather than a generic
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
 * Current Status badge (lab-03/ui-spec.md §3.1). Shared by My Tickets,
 * Ticket Detail and the IT Staff Ticket Queue.
 *
 * Always renders the text label so status is never carried by color alone
 * (ui-spec.md §12/§13). A value outside the known set still renders —
 * neutral default style, humanized label — instead of crashing or leaving
 * a blank badge ("the component switches on value, default style for
 * unknown").
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
