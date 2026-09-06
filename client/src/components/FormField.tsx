import { cloneElement, type ReactElement } from "react";
import "./FormField.css";

export interface FormFieldCounter {
  current: number;
  max: number;
}

/** Attributes FormField injects into the wrapped control via cloneElement. */
export interface FormFieldControlProps {
  id?: string;
  "aria-required"?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export interface FormFieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  /** Character counter, e.g. 12/140 (ui-spec.md §5.2). */
  counter?: FormFieldCounter;
  children: ReactElement<FormFieldControlProps>;
}

/**
 * Label + control + helper/counter + error wrapper (ui-spec.md §5.2).
 *
 * - Renders a real `<label htmlFor>` and a visually red, `aria-hidden`
 *   asterisk for required fields (the asterisk never replaces the error
 *   message — BR referenced in §5.2).
 * - Clones the single child control to inject `id`, `aria-required`,
 *   `aria-invalid`, and `aria-describedby` (pointing at helper and/or
 *   error ids).
 * - The error message renders with `role="alert"` directly under the
 *   field.
 */
export function FormField({
  id,
  label,
  required = false,
  error,
  helperText,
  counter,
  children,
}: FormFieldProps) {
  const helperId = helperText ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [helperId, errorId].filter(Boolean).join(" ") || undefined;

  const control = cloneElement(children, {
    id,
    "aria-required": required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  });

  const counterOverMax = counter ? counter.current > counter.max : false;

  return (
    <div className="zen-field">
      <label htmlFor={id} className="zen-field__label">
        {label}
        {required && (
          <span className="zen-field__required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>

      <div className="zen-field__control">{control}</div>

      {(helperText || counter) && (
        <div className="zen-field__meta">
          <span id={helperId} className="zen-field__helper">
            {helperText}
          </span>
          {counter && (
            <span
              className={
                counterOverMax
                  ? "zen-field__counter zen-field__counter--error"
                  : "zen-field__counter"
              }
            >
              {counter.current}/{counter.max}
            </span>
          )}
        </div>
      )}

      {error && (
        <div id={errorId} role="alert" className="zen-field__error">
          {error}
        </div>
      )}
    </div>
  );
}
