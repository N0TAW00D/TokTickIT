import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardForbiddenError } from "./api";

export type DashboardState<T> =
  | { phase: "loading" }
  | { phase: "loaded"; data: T; refreshing: boolean }
  | { phase: "forbidden" }
  | { phase: "error" };

/**
 * Loads one dashboard payload (lab-04 ui-spec.md §3.3). `retry` goes back
 * through the loading state (no stale numbers after a failure); `refresh`
 * keeps the previous payload visible and flags `refreshing` until the new
 * one arrives. A response that lands after a newer request started, or after
 * unmount, is dropped.
 */
export function useDashboard<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<DashboardState<T>>({ phase: "loading" });
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback((mode: "initial" | "refresh") => {
    const requestId = ++latest.current;
    if (mode === "initial") {
      setState({ phase: "loading" });
    } else {
      setState((current) =>
        current.phase === "loaded" ? { ...current, refreshing: true } : { phase: "loading" },
      );
    }
    fetcherRef.current().then(
      (data) => {
        if (requestId !== latest.current) return;
        setState({ phase: "loaded", data, refreshing: false });
      },
      (error: unknown) => {
        if (requestId !== latest.current) return;
        setState(
          error instanceof DashboardForbiddenError ? { phase: "forbidden" } : { phase: "error" },
        );
      },
    );
  }, []);

  useEffect(() => {
    run("initial");
    return () => {
      latest.current += 1;
    };
  }, [run]);

  return {
    state,
    retry: useCallback(() => run("initial"), [run]),
    refresh: useCallback(() => run("refresh"), [run]),
  };
}
