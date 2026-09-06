import { forwardRef, type TextareaHTMLAttributes } from "react";
import "./Controls.css";

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Multi-line text control (ui-spec.md §5.3): same control styling as
 * TextInput, taller (min-height 120px), vertical-resize only, capped so
 * layout never breaks.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ className, readOnly, ...rest }, ref) {
    const classNames = [
      "zen-textarea",
      readOnly ? "zen-textarea--readonly" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <textarea
        ref={ref}
        readOnly={readOnly}
        className={classNames}
        {...rest}
      />
    );
  },
);
