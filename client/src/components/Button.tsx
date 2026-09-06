import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "destructive";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Visual style, per ui-spec.md §5.1. Defaults to "primary". */
  variant?: ButtonVariant;
  /**
   * Pending state (ui-spec.md §5.1 "busy" row): shows a spinner glyph,
   * keeps the label text, and disables the button while a request is in
   * flight (BR-24).
   */
  busy?: boolean;
  children: ReactNode;
}

/**
 * Reusable Zen Green button (ui-spec.md §5.1).
 *
 * Always renders visible text (icons may only accompany, never replace,
 * the label). `disabled` and `busy` both render a non-activatable button;
 * `busy` additionally shows a spinner while keeping the label unchanged.
 */
export function Button({
  variant = "primary",
  busy = false,
  disabled = false,
  className,
  onClick,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || busy;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (isDisabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  // `{...rest}` is spread first so it can never override the computed
  // `type`/`className`/`disabled`/`aria-disabled`/`aria-busy`/`onClick`
  // attributes below — a caller-supplied `aria-disabled`/`aria-busy` (the
  // only two of these that survive destructuring into `rest`) must not be
  // able to contradict the button's real disabled/busy state.
  const classNames = [
    "zen-btn",
    `zen-btn--${variant}`,
    busy ? "zen-btn--busy" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      type={type}
      className={classNames}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={busy || undefined}
      onClick={handleClick}
    >
      {busy && <span className="zen-btn__spinner" aria-hidden="true" />}
      <span className="zen-btn__label">{children}</span>
    </button>
  );
}
