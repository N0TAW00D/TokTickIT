import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { fetchRequesters } from "../requester/api";
import { useRequester } from "../requester/RequesterContext";
import { LoadingState } from "../components/LoadingState";

type GuardStatus = "checking" | "valid" | "invalid" | "no-selection";

function initialStatus(
  requesterId: number | null,
  requesterName: string | null,
): GuardStatus {
  if (requesterId === null) return "no-selection";
  if (requesterName !== null) return "valid";
  return "checking";
}

/**
 * Route guard for Requester-scoped screens (specification.md FR-05, BR-10).
 *
 * - No stored id at all -> straight to the selection screen, no notice
 *   (AC-02, C-01).
 * - A stored id whose name hasn't been confirmed yet (e.g. right after a
 *   page load restored it from localStorage) -> re-validate it against
 *   `GET /api/requesters`. A match hydrates the context's Requester name;
 *   no match clears the stored id and routes to the selection screen with
 *   the "no longer available" notice (AC-08, BR-10, C-06).
 * - A validation-fetch failure is inconclusive, not proof of invalidity: the
 *   stored id is left alone and the user is sent to the selection screen
 *   without the notice, where its own fetch surfaces the real error state
 *   (AC-05). This case isn't covered by a specific AC/test; it is this
 *   guard's documented choice for "we couldn't check."
 */
export function RequireRequester({ children }: { children: ReactNode }) {
  const { requesterId, requesterName, selectRequester, clearRequester } =
    useRequester();
  const [status, setStatus] = useState<GuardStatus>(() =>
    initialStatus(requesterId, requesterName),
  );
  // This guard instance makes exactly one verdict per mount. Without this,
  // clearRequester()'s own state update would change `requesterId`, which
  // would re-run this effect and could overwrite an already-decided
  // "invalid" verdict with "no-selection" before the resulting <Navigate>
  // has a chance to carry its stale-requester notice state.
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (resolvedRef.current) return;

    if (requesterId === null) {
      resolvedRef.current = true;
      setStatus("no-selection");
      return;
    }
    if (requesterName !== null) {
      resolvedRef.current = true;
      setStatus("valid");
      return;
    }

    let cancelled = false;
    setStatus("checking");

    fetchRequesters()
      .then((requesters) => {
        if (cancelled) return;
        resolvedRef.current = true;
        const match = requesters.find(
          (requester) => requester.id === requesterId,
        );
        if (match) {
          selectRequester({ id: match.id, name: match.name });
          setStatus("valid");
        } else {
          clearRequester();
          setStatus("invalid");
        }
      })
      .catch(() => {
        if (cancelled) return;
        resolvedRef.current = true;
        setStatus("no-selection");
      });

    return () => {
      cancelled = true;
    };
  }, [requesterId, requesterName, selectRequester, clearRequester]);

  if (status === "checking") {
    // ui-spec.md §5.4: loading regions use LoadingState (role="status")
    // rather than a blank container, so a reload of a guarded route with a
    // stored id has a visible + screen-reader-announced affordance while
    // the stored id is being re-validated against GET /api/requesters.
    return <LoadingState />;
  }

  if (status === "invalid") {
    return (
      <Navigate
        to="/select-requester"
        replace
        state={{ requesterUnavailable: true }}
      />
    );
  }

  if (status === "no-selection") {
    return <Navigate to="/select-requester" replace />;
  }

  return <>{children}</>;
}
