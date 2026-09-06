import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PriorityBadge } from "../../src/components/PriorityBadge.tsx";
import { StatusBadge } from "../../src/components/StatusBadge.tsx";

afterEach(() => {
  cleanup();
});

describe("PriorityBadge", () => {
  it.each([
    ["LOW", "Low", "zen-badge--priority-low"],
    ["MEDIUM", "Medium", "zen-badge--priority-medium"],
    ["HIGH", "High", "zen-badge--priority-high"],
  ] as const)("renders the %s label and variant class", (value, label, className) => {
    render(<PriorityBadge value={value} />);

    const badge = screen.getByText(label).closest(".zen-badge");
    expect(badge).not.toBeNull();
    expect(badge).toHaveClass(className);
  });

  it("always renders the text label alongside the icon (ui-spec.md §12: color is never the sole signal)", () => {
    const { container } = render(<PriorityBadge value="HIGH" />);

    expect(screen.getByText("High")).toBeInTheDocument();
    expect(container.querySelector(".zen-badge__icon")).not.toBeNull();
  });

  it("hides the icon from the accessibility tree", () => {
    const { container } = render(<PriorityBadge value="LOW" />);

    const icon = container.querySelector(".zen-badge__icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to a humanized label and the default style for an unknown value, without crashing", () => {
    const { container } = render(<PriorityBadge value="URGENT" />);

    const badge = screen.getByText("Urgent").closest(".zen-badge");
    expect(badge).not.toBeNull();
    expect(badge).toHaveClass("zen-badge--unknown");
    // No icon is defined for an unrecognized priority.
    expect(container.querySelector(".zen-badge__icon")).toBeNull();
  });

  it("humanizes a snake_case unknown value word by word", () => {
    render(<PriorityBadge value="needs_review" />);

    expect(screen.getByText("Needs Review")).toBeInTheDocument();
  });

  it("falls back to the literal word 'Unknown' for an empty value instead of a blank badge", () => {
    render(<PriorityBadge value="" />);

    const badge = screen.getByText("Unknown").closest(".zen-badge");
    expect(badge).not.toBeNull();
    expect(badge).toHaveClass("zen-badge--unknown");
  });
});

describe("StatusBadge", () => {
  it("renders the New label and variant class", () => {
    render(<StatusBadge value="NEW" />);

    const badge = screen.getByText("New").closest(".zen-badge");
    expect(badge).not.toBeNull();
    expect(badge).toHaveClass("zen-badge--status-new");
  });

  it("falls back to a humanized label and the default style for an unknown value, without crashing", () => {
    render(<StatusBadge value="IN_PROGRESS" />);

    const badge = screen.getByText("In Progress").closest(".zen-badge");
    expect(badge).not.toBeNull();
    expect(badge).toHaveClass("zen-badge--unknown");
  });
});

describe("Badge shared shell", () => {
  it("applies the same base zen-badge class to both priority and status badges", () => {
    const { unmount } = render(<PriorityBadge value="MEDIUM" />);
    expect(screen.getByText("Medium").closest(".zen-badge")).toHaveClass(
      "zen-badge",
    );
    unmount();

    render(<StatusBadge value="NEW" />);
    expect(screen.getByText("New").closest(".zen-badge")).toHaveClass(
      "zen-badge",
    );
  });
});
