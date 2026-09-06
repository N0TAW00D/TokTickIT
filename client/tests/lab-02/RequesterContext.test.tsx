import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  REQUESTER_STORAGE_KEY,
  RequesterProvider,
  useRequester,
} from "../../src/requester/RequesterContext.tsx";

function Harness() {
  const { requesterId, requesterName, selectRequester, clearRequester } =
    useRequester();

  return (
    <div>
      <p data-testid="id">{requesterId ?? "none"}</p>
      <p data-testid="name">{requesterName ?? "none"}</p>
      <button
        onClick={() => selectRequester({ id: 7, name: "Sarah Johnson" })}
      >
        select
      </button>
      <button onClick={clearRequester}>clear</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <RequesterProvider>
      <Harness />
    </RequesterProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("RequesterProvider initial state", () => {
  it("starts with no requester when localStorage is empty", () => {
    renderHarness();

    expect(screen.getByTestId("id")).toHaveTextContent("none");
    expect(screen.getByTestId("name")).toHaveTextContent("none");
  });

  it("reads a previously stored id on mount; the name stays unhydrated until validated", () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, "5");

    renderHarness();

    expect(screen.getByTestId("id")).toHaveTextContent("5");
    expect(screen.getByTestId("name")).toHaveTextContent("none");
  });

  it("ignores a non-numeric stored value", () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, "not-a-number");

    renderHarness();

    expect(screen.getByTestId("id")).toHaveTextContent("none");
  });

  it("ignores a non-positive stored value", () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, "-3");

    renderHarness();

    expect(screen.getByTestId("id")).toHaveTextContent("none");
  });
});

describe("selectRequester", () => {
  it("persists the id under exactly toktickit.requesterId and updates state", () => {
    renderHarness();

    fireEvent.click(screen.getByText("select"));

    expect(screen.getByTestId("id")).toHaveTextContent("7");
    expect(screen.getByTestId("name")).toHaveTextContent("Sarah Johnson");
    expect(window.localStorage.getItem("toktickit.requesterId")).toBe("7");
  });
});

describe("clearRequester", () => {
  it("removes the stored id and resets state", () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, "5");
    renderHarness();

    fireEvent.click(screen.getByText("clear"));

    expect(screen.getByTestId("id")).toHaveTextContent("none");
    expect(screen.getByTestId("name")).toHaveTextContent("none");
    expect(window.localStorage.getItem(REQUESTER_STORAGE_KEY)).toBeNull();
  });
});

describe("useRequester outside a RequesterProvider", () => {
  it("throws a helpful error instead of returning undefined", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Harness />)).toThrow(/RequesterProvider/);
  });
});
