import { Link } from "react-router-dom";
import "./MetricCard.css";

export interface MetricCardProps {
  label: string;
  value: number;
  /** Drill-down list URL (api-spec.md §4/§5) — the whole card is this one link. */
  to: string;
  /** Always shown. A needs-attention card must say so in words (colour is never the only cue). */
  subLabel: string;
  /** Needs-attention variant: adds the left accent border alongside `subLabel`. */
  attention?: boolean;
}

/** Sub-label shown on a zero card (lab-04 ui-spec.md §3.2). */
export const ZERO_SUB_LABEL = "None right now";

/**
 * Dashboard metric card (lab-04 ui-spec.md §3.2): label, value, sub-label
 * and a visible "View list" affordance inside a single link whose accessible
 * name carries the same number as the visible value ("Unassigned: 2, view
 * list"). The accent class is only ever applied together with the sub-label
 * text, which the caller supplies in words.
 */
export function MetricCard({ label, value, to, subLabel, attention = false }: MetricCardProps) {
  return (
    <Link
      to={to}
      className={`zen-metric-card${attention ? " zen-metric-card--attention" : ""}`}
      aria-label={`${label}: ${value}, view list`}
    >
      <span className="zen-metric-card__label">{label}</span>
      <span className="zen-metric-card__value">{value}</span>
      <span className="zen-metric-card__sublabel">{subLabel}</span>
      <span className="zen-metric-card__affordance" aria-hidden="true">
        View list →
      </span>
    </Link>
  );
}
