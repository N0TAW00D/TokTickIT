import { FormField } from "./FormField";
import "./Controls.css";

export interface SegmentedControlOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SegmentedControlOption[];
  disabled?: boolean;
  error?: string;
  helperText?: string;
}

/**
 * Segmented control (ui-spec.md §10: "Segmented control, three values.
 * Saves on change."). A generic label/error/helper field — same
 * `FormField` wrapper `SelectField` uses — that renders `options` as a
 * single row of mutually-exclusive buttons rather than a dropdown, for
 * small, always-visible option sets (currently just IT Priority, but not
 * hard-coded to it).
 *
 * `role="radiogroup"`/`role="radio"`/`aria-checked` (rather than a native
 * `<select>`) since there's no native "row of buttons" element; this is
 * the same amount of ARIA `SelectField` leans on native `<select>` to get
 * for free. Clicking the already-active segment is a no-op — `onChange`
 * only fires for an actual change, same as `SelectField`'s callers already
 * assume (e.g. `StaffTicketDetailScreen.tsx`'s `handleOwnerSelectChange`).
 */
export function SegmentedControl({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
  error,
  helperText,
}: SegmentedControlProps) {
  return (
    <FormField id={id} label={label} error={error} helperText={helperText}>
      <div
        id={id}
        role="radiogroup"
        aria-label={label}
        className={
          error ? "zen-segmented zen-segmented--invalid" : "zen-segmented"
        }
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              className={
                active
                  ? "zen-segmented__option zen-segmented__option--active"
                  : "zen-segmented__option"
              }
              onClick={() => {
                if (!disabled && option.value !== value) {
                  onChange(option.value);
                }
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </FormField>
  );
}
