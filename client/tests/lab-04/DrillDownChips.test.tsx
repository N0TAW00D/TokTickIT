import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DrillDownChips } from "../../src/components/DrillDownChips.tsx";

// Review follow-up on #98: the remove control needs visible text (Lab 2
// ui-spec: buttons never rely on an icon alone) while its accessible name
// still says which filter it removes. Hit-area size is measured in
// e2e/lab-04/drilldown-chips.spec.ts (jsdom has no layout).

afterEach(cleanup);

describe("DrillDownChips remove button", () => {
  it("shows a visible 'Remove' label and names the filter it removes", () => {
    const onRemove = vi.fn();
    render(<DrillDownChips chips={[{ key: "s", label: "Status Open", onRemove }]} />);
    const button = screen.getByRole("button", { name: "Remove filter: Status Open" });
    expect(button.textContent).toContain("Remove");
    fireEvent.click(button);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("gives each chip its own named remove button", () => {
    render(
      <DrillDownChips
        chips={[
          { key: "a", label: "Status Open", onRemove: () => {} },
          { key: "b", label: "My open actions", onRemove: () => {} },
        ]}
      />,
    );
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove filter: Status Open",
      "Remove filter: My open actions",
    ]);
  });
});
