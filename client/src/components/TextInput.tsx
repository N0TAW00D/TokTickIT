import { forwardRef, type InputHTMLAttributes } from "react";
import "./Controls.css";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Single-line text control (ui-spec.md §5.3). Renders the read-only
 * presentation when given the `readOnly` prop — distinct background and
 * text color, no caret, while remaining screen-reader announced.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, readOnly, ...rest }, ref) {
    const classNames = [
      "zen-input",
      readOnly ? "zen-input--readonly" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <input ref={ref} readOnly={readOnly} className={classNames} {...rest} />
    );
  },
);
