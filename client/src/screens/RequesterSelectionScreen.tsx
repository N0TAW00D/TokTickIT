import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { SelectField } from "../components/SelectField";
import { LoadingState } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { fetchRequesters, type RequesterSummary } from "../requester/api";
import { useRequester } from "../requester/RequesterContext";
import "./RequesterSelectionScreen.css";

const REQUESTER_SELECT_ID = "requester-select";

type LoadState =
  | { phase: "loading" }
  | { phase: "loaded"; requesters: RequesterSummary[] }
  | { phase: "empty" }
  | { phase: "error"; message: string };

interface SelectionLocationState {
  /** Set by the route guard when a stored id was cleared (BR-10, AC-08). */
  requesterUnavailable?: boolean;
}

/**
 * Development Requester Selection screen (ui-spec.md §6, FR-01..FR-06).
 * Stands in for login: load the active Requesters, let the tester pick one,
 * persist the choice, and hand off to `/tickets`.
 */
export function RequesterSelectionScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requesterId, requesterName, selectRequester } = useRequester();

  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [selectedId, setSelectedId] = useState("");
  const regionRef = useRef<HTMLDivElement>(null);

  const showStaleNotice = Boolean(
    (location.state as SelectionLocationState | null)?.requesterUnavailable,
  );

  const load = useCallback(() => {
    setState({ phase: "loading" });
    fetchRequesters()
      .then((requesters) => {
        if (requesters.length === 0) {
          setState({ phase: "empty" });
          return;
        }
        setState({
          phase: "loaded",
          requesters: [...requesters].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        });
      })
      .catch(() => {
        setState({
          phase: "error",
          message:
            "Could not load development requesters. Please check your connection and try again.",
        });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ui-spec.md §6 accessibility: focus lands on the select (or the
  // error/empty heading) once the phase it belongs to is showing.
  useEffect(() => {
    if (state.phase === "loaded") {
      document.getElementById(REQUESTER_SELECT_ID)?.focus();
    } else if (state.phase === "error" || state.phase === "empty") {
      regionRef.current?.focus();
    }
  }, [state.phase]);

  const canCancel = requesterId !== null && requesterName !== null;

  function handleCancel() {
    if (!canCancel) return;
    navigate("/tickets");
  }

  function handleContinue() {
    if (state.phase !== "loaded") return;
    const match = state.requesters.find(
      (requester) => String(requester.id) === selectedId,
    );
    if (!match) return;
    selectRequester({ id: match.id, name: match.name });
    navigate("/tickets", { replace: true });
  }

  const canContinue = state.phase === "loaded" && selectedId !== "";

  return (
    <div className="zen-selection-screen">
      <header className="zen-selection-screen__topbar">
        <span className="zen-selection-screen__wordmark">⌚ TokTickIT</span>
      </header>

      <main className="zen-selection-screen__main">
        <div className="zen-selection-screen__card">
          <div className="zen-selection-screen__icon" aria-hidden="true">
            👤⚙
          </div>
          <h1>Select Development Requester</h1>
          <p className="zen-selection-screen__description">
            Choose a development requester to simulate the current requester
            context for Lab 2. This is for testing only and is not a login
            screen.
          </p>

          {showStaleNotice && (
            <div role="status" className="zen-selection-screen__notice">
              Your previous development requester is no longer available.
              Please choose again.
            </div>
          )}

          {state.phase === "loading" && <LoadingState />}

          {state.phase === "loaded" && (
            <>
              <SelectField
                id={REQUESTER_SELECT_ID}
                label="Development Requester"
                required
                value={selectedId}
                onChange={setSelectedId}
                placeholder="Select a requester…"
                options={state.requesters.map((requester) => ({
                  value: String(requester.id),
                  label: requester.name,
                }))}
              />
              <p className="zen-selection-screen__info">
                ⓘ Only active development requesters are shown.
              </p>
            </>
          )}

          {state.phase === "empty" && (
            <div ref={regionRef} tabIndex={-1}>
              <EmptyState
                title="No active development requesters."
                description="Ask an administrator to add one, then reload."
              />
            </div>
          )}

          {state.phase === "error" && (
            <div ref={regionRef} tabIndex={-1}>
              <ErrorState message={state.message} onRetry={load} />
            </div>
          )}

          <p className="zen-selection-screen__callout">
            🛡 Authentication coming in Lab 3 — this selection is replaced
            with secure authentication.
          </p>

          <div className="zen-selection-screen__actions">
            <Button
              variant="secondary"
              disabled={!canCancel}
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canContinue}
              onClick={handleContinue}
            >
              Continue →
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
