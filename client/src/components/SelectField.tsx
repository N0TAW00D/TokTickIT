import type { ChangeEvent } from "react";
import { FormField } from "./FormField";
import "./Controls.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  required?: boolean;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  /** Rendered as the first, empty-valued option (e.g. "Select…"). */
  placeholder?: string;
}

/**
 * Native `<select>` wrapped in the FormField label/error/helper pattern
 * (ui-spec.md §5.3) — kept native for accessibility rather than a custom
 * listbox widget.
 */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  required = false,
  error,
  helperText,
  disabled = false,
  placeholder,
}: SelectFieldProps) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(event.target.value);
  }

  return (
    <FormField
      id={id}
      label={label}
      required={required}
      error={error}
      helperText={helperText}
    >
      <select
        className={error ? "zen-select zen-select--invalid" : "zen-select"}
        value={value}
        disabled={disabled}
        onChange={handleChange}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
