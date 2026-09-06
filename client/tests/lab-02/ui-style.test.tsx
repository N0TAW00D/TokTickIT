import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "../../src/components/Button.tsx";
import { FormField } from "../../src/components/FormField.tsx";
import { TextInput } from "../../src/components/TextInput.tsx";
import { SelectField } from "../../src/components/SelectField.tsx";
import { LoadingState } from "../../src/components/LoadingState.tsx";
import { EmptyState } from "../../src/components/EmptyState.tsx";
import { NoResultsState } from "../../src/components/NoResultsState.tsx";
import { ErrorState } from "../../src/components/ErrorState.tsx";

afterEach(() => {
  cleanup();
});

describe("Button variants", () => {
  it.each([
    ["primary", "zen-btn--primary"],
    ["secondary", "zen-btn--secondary"],
    ["tertiary", "zen-btn--tertiary"],
    ["destructive", "zen-btn--destructive"],
  ] as const)("applies the %s variant class", (variant, expectedClass) => {
    render(<Button variant={variant}>Action</Button>);

    const button = screen.getByRole("button", { name: "Action" });
    expect(button).toHaveClass("zen-btn");
    expect(button).toHaveClass(expectedClass);
  });
});

describe("Button disabled state", () => {
  it("cannot be activated and is marked disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Button busy state", () => {
  it("keeps its label, shows a spinner, and does not fire onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button busy onClick={onClick}>
        Submitting…
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Submitting…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".zen-btn__spinner")).not.toBeNull();

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Button computed attribute precedence", () => {
  it("does not let a caller-supplied aria-disabled/aria-busy contradict the real button state", () => {
    render(
      <Button aria-disabled={true} aria-busy={true}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("keeps the computed aria-disabled true even if the caller passes aria-disabled={false} while disabled", () => {
    render(
      <Button disabled aria-disabled={false}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});

describe("FormField required + error", () => {
  it("renders a required asterisk and associates the error message via aria-describedby", () => {
    render(
      <FormField
        id="summary"
        label="Ticket Summary"
        required
        error="Summary is required."
      >
        <TextInput />
      </FormField>,
    );

    const label = screen.getByText("Ticket Summary").closest("label");
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent("*");

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Summary is required.");
    expect(describedBy).toContain(alert.id);
  });

  it("merges a caller-supplied aria-describedby with the helper/error ids instead of overwriting it", () => {
    render(
      <FormField
        id="summary"
        label="Ticket Summary"
        helperText="Keep it under 140 characters."
        error="Summary is required."
      >
        <TextInput aria-describedby="external-note" />
      </FormField>,
    );

    const input = screen.getByRole("textbox");
    const describedBy = input.getAttribute("aria-describedby");

    // The caller-supplied id survives alongside the helper and error ids.
    expect(describedBy).toBe("external-note summary-helper summary-error");
  });

  it("turns the character counter error-colored past the max", () => {
    const { rerender, container } = render(
      <FormField id="summary" label="Ticket Summary" counter={{ current: 12, max: 140 }}>
        <TextInput />
      </FormField>,
    );

    expect(screen.getByText("12/140")).not.toHaveClass(
      "zen-field__counter--error",
    );

    rerender(
      <FormField id="summary" label="Ticket Summary" counter={{ current: 141, max: 140 }}>
        <TextInput />
      </FormField>,
    );

    expect(screen.getByText("141/140")).toHaveClass(
      "zen-field__counter--error",
    );
    expect(container.querySelectorAll(".zen-field__counter")).toHaveLength(1);
  });
});

describe("SelectField", () => {
  it("wraps a native select with a real associated label", () => {
    const onChange = vi.fn();
    render(
      <SelectField
        id="category"
        label="Category"
        value=""
        onChange={onChange}
        placeholder="Select…"
        options={[
          { value: "hardware", label: "Hardware" },
          { value: "network", label: "Network" },
        ]}
      />,
    );

    const select = screen.getByLabelText("Category") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");

    fireEvent.change(select, { target: { value: "network" } });

    expect(onChange).toHaveBeenCalledWith("network");
  });
});

describe("Read-only vs editable control styling", () => {
  it("gives a read-only TextInput a distinct class from an editable one", () => {
    render(
      <div>
        <TextInput aria-label="Editable field" value="editable" onChange={() => {}} />
        <TextInput aria-label="Read-only field" value="fixed" readOnly />
      </div>,
    );

    const editable = screen.getByLabelText("Editable field");
    const readOnly = screen.getByLabelText("Read-only field");

    expect(editable).not.toHaveClass("zen-input--readonly");
    expect(readOnly).toHaveClass("zen-input--readonly");
    expect(readOnly).toHaveAttribute("readonly");
  });
});

describe("LoadingState", () => {
  it("renders a polite status region with the loading text", () => {
    render(<LoadingState />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading…");
  });
});

describe("EmptyState vs NoResultsState", () => {
  it("renders visibly distinct content for empty vs no-results", () => {
    const { unmount } = render(
      <EmptyState
        title="You haven't created any tickets yet."
        description="Create your first ticket to get started."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "You haven't created any tickets yet." }),
    ).toBeInTheDocument();

    unmount();

    const onClearFilters = vi.fn();
    render(
      <NoResultsState
        message="No tickets match your search or filters."
        onClearFilters={onClearFilters}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: /haven't created/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("No tickets match your search or filters."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorState", () => {
  it("renders an assertive alert with a working Retry action", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState message="Could not load tickets." onRetry={onRetry} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load tickets.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("pairs the message with a decorative warning glyph (ui-spec.md §12: color is never the sole signal)", () => {
    const { container } = render(<ErrorState message="Could not load tickets." />);

    const icon = container.querySelector(".zen-error-state__icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveTextContent("⚠");

    // The glyph is visible alongside the message, but hidden from assistive
    // tech so the role="alert" region announces only the message text.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("⚠");
    expect(alert.textContent).toContain("Could not load tickets.");
  });
});
