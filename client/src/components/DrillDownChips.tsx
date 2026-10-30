import "./DrillDownChips.css";

export interface DrillDownChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface DrillDownChipsProps {
  chips: DrillDownChip[];
  disabled?: boolean;
}

/**
 * Chip row that makes an active dashboard drill-down visible and clearable
 * (lab-04 ui-spec.md §2). Each chip is text plus a real remove button, so
 * the filter is never conveyed by colour alone. Renders nothing when there
 * is no drill-down active.
 */
export function DrillDownChips({ chips, disabled = false }: DrillDownChipsProps) {
  if (chips.length === 0) return null;
  return (
    <ul className="zen-chip-row" aria-label="Active filters">
      {chips.map((chip) => (
        <li key={chip.key} className="zen-chip">
          <span className="zen-chip__label">{chip.label}</span>
          <button
            type="button"
            className="zen-chip__remove"
            aria-label={`Remove filter: ${chip.label}`}
            disabled={disabled}
            onClick={chip.onRemove}
          >
            <span aria-hidden="true">×</span>
            <span className="zen-chip__remove-text">Remove</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
