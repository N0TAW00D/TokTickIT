import "./Badge.css";

/** Known priority values, shared by Requested and IT Priority (ui-spec.md §7.1, lab-03/ui-spec.md §3.2). */
export type PriorityValue = "LOW" | "MEDIUM" | "HIGH";

/**
 * Which priority this badge shows (lab-03/ui-spec.md §3.2): `requested` is
 * the Lab 2 Requested Priority (unchanged colours, no prefix); `it` is the
 * Lab 3 IT Priority — same three colours, plus a solid 2px left border in
 * the text colour and an "IT: " label prefix, so the two are never
 * confused when they appear side by side on the same queue row.
 */
export type PriorityBadgeVariant = "requested" | "it";

export interface PriorityBadgeProps {
  /**
   * Priority to render. Typed as `PriorityValue | (string & {})` rather
   * than the bare union: editors still suggest LOW/MEDIUM/HIGH, but the
   * type doesn't reject a value this build doesn't recognize yet — the
   * badge is meant to degrade gracefully instead (see the fallback below).
   */
  value: PriorityValue | (string & {});
  /** Defaults to "requested" — Lab 2's only variant, unchanged. */
  variant?: PriorityBadgeVariant;
}

interface PriorityPresentation {
  label: string;
  /** Decorative glyph shown alongside the label; never the only content. */
  icon: string | null;
  className: string;
}

/**
 * Value → presentation table (ui-spec.md §7.1). Everything that varies by
 * priority lives in this one object; the render logic below never branches
 * on the value itself, so adding a row is the only change a future priority
 * value would need.
 */
const PRIORITY_PRESENTATION: Record<PriorityValue, PriorityPresentation> = {
  LOW: {
    label: "Low",
    icon: "▽",
    className: "zen-badge--priority-low",
  },
  MEDIUM: {
    label: "Medium",
    icon: "▷",
    className: "zen-badge--priority-medium",
  },
  HIGH: {
    label: "High",
    icon: "△",
    className: "zen-badge--priority-high",
  },
};

function isKnownPriority(value: string): value is PriorityValue {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH";
}

/**
 * Fallback label for a value outside the known set: a title-cased rendering
 * of the raw value ("URGENT" → "Urgent", "needs_review" → "Needs Review")
 * rather than a generic "Unknown". An unrecognized value reaching this
 * component is most likely a real value the UI hasn't been taught to style
 * yet (ui-spec.md §7.2 notes Lab 3 adds more values), and showing the
 * requester the actual word beats hiding real information behind a
 * placeholder. An empty/whitespace-only value is the one case with nothing
 * to show, so that alone falls back to the literal word "Unknown".
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
 * Priority badge (ui-spec.md §7.1, lab-03/ui-spec.md §3.2). Shared by My
 * Tickets, Ticket Detail and the IT Staff Ticket Queue.
 *
 * Always renders the text label — the icon only accompanies it and is
 * `aria-hidden`, since the label alone already carries the meaning (§12:
 * color/icon is never the sole signal). A value outside LOW/MEDIUM/HIGH
 * still renders — neutral style, no icon, humanized label — instead of
 * crashing or leaving a blank badge (§7.2's "default style for unknown",
 * which applies equally here since the two badges share one table shape).
 *
 * `variant="it"` adds the left-border modifier class and prefixes the
 * label with "IT: " (lab-03/ui-spec.md §3.2) — including on the unknown
 * fallback, so an IT Priority badge never silently loses its "IT:" framing
 * just because the value is one this build doesn't recognize yet.
 */
export function PriorityBadge({ value, variant = "requested" }: PriorityBadgeProps) {
  const presentation: PriorityPresentation = isKnownPriority(value)
    ? PRIORITY_PRESENTATION[value]
    : {
        label: humanizeUnknown(value),
        icon: null,
        className: "zen-badge--unknown",
      };

  const label = variant === "it" ? `IT: ${presentation.label}` : presentation.label;
  const className =
    variant === "it"
      ? `zen-badge ${presentation.className} zen-badge--it-priority`
      : `zen-badge ${presentation.className}`;

  return (
    <span className={className}>
      {presentation.icon !== null && (
        <span className="zen-badge__icon" aria-hidden="true">
          {presentation.icon}
        </span>
      )}
      <span className="zen-badge__label">{label}</span>
    </span>
  );
}
