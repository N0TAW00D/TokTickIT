import type { ReactNode } from "react";
import { AppShell } from "../shell/AppShell";
import { Button } from "../components/Button";
import { ErrorState } from "../components/ErrorState";
import { ForbiddenState } from "../routes/RequireRole";
import { formatUpdated } from "./formatUpdated";
import type { DashboardState } from "./useDashboard";
import "./Dashboard.css";

interface DashboardFrameProps<T extends { generatedAt: string }> {
  state: DashboardState<T>;
  onRetry: () => void;
  onRefresh: () => void;
  /** Loaded content; only called with a payload, so no stale or partial numbers can render otherwise. */
  children: (data: T) => ReactNode;
}

/** Skeleton cards (lab-04 ui-spec.md §3.3): one polite `role="status"`, the blocks themselves are decorative. */
function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <span className="zen-visually-hidden">Loading dashboard…</span>
      <div className="zen-dashboard__metrics zen-dashboard__metrics--4" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="zen-dashboard__skeleton" />
        ))}
      </div>
    </div>
  );
}

/**
 * Shared dashboard chrome (lab-04 ui-spec.md §3.1, §3.3): `h1`, the
 * "Updated" time and Refresh button, and the loading / forbidden / failure
 * states. The forbidden and failure states replace the page body entirely,
 * so no number is ever shown alongside them.
 */
export function DashboardFrame<T extends { generatedAt: string }>({
  state,
  onRetry,
  onRefresh,
  children,
}: DashboardFrameProps<T>) {
  if (state.phase === "forbidden") {
    return (
      <AppShell>
        <ForbiddenState />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="zen-dashboard">
        <div className="zen-dashboard__header">
          <h1>Dashboard</h1>
          {state.phase === "loaded" && (
            <div className="zen-dashboard__header-actions">
              <span className="zen-dashboard__updated">{formatUpdated(state.data.generatedAt)}</span>
              <Button variant="secondary" busy={state.refreshing} onClick={onRefresh}>
                Refresh
              </Button>
            </div>
          )}
        </div>

        {state.phase === "loading" && <DashboardLoading />}
        {state.phase === "error" && (
          <ErrorState message="We couldn't load the dashboard." onRetry={onRetry} />
        )}
        {state.phase === "loaded" && children(state.data)}
      </div>
    </AppShell>
  );
}
