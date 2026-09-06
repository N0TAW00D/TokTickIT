import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * localStorage key for the selected Development Requester id
 * (specification.md BR-09). There is no server-side session — this is the
 * entire client-side "current user" state.
 */
export const REQUESTER_STORAGE_KEY = "toktickit.requesterId";

export interface Requester {
  id: number;
  name: string;
}

export interface RequesterContextValue {
  /** The stored/selected Requester id, or null if none is selected. */
  requesterId: number | null;
  /**
   * The Requester's display name. Null until it has been confirmed against
   * the active Requester list — e.g. right after a page load restores an id
   * from localStorage but hasn't yet validated it (see the route guard in
   * ../routes/RequireRequester.tsx, BR-10).
   */
  requesterName: string | null;
  /** Persists the choice to localStorage and updates context state. */
  selectRequester: (requester: Requester) => void;
  /** Clears the stored id and resets context state (BR-11). */
  clearRequester: () => void;
}

const RequesterContext = createContext<RequesterContextValue | undefined>(
  undefined,
);

function readStoredRequesterId(): number | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(REQUESTER_STORAGE_KEY);
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface RequesterProviderProps {
  children: ReactNode;
}

/**
 * Holds the current Development Requester "context" (ui-spec.md §4,
 * specification.md FR-01..FR-05). This is a client-only stand-in for a real
 * session (BR-03, BR-09) — it is deliberately unaware of the network; the
 * route guard is responsible for validating a restored id against the
 * active Requester list.
 */
export function RequesterProvider({ children }: RequesterProviderProps) {
  const [requesterId, setRequesterId] = useState<number | null>(() =>
    readStoredRequesterId(),
  );
  const [requesterName, setRequesterName] = useState<string | null>(null);

  const selectRequester = useCallback((requester: Requester) => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, String(requester.id));
    setRequesterId(requester.id);
    setRequesterName(requester.name);
  }, []);

  const clearRequester = useCallback(() => {
    window.localStorage.removeItem(REQUESTER_STORAGE_KEY);
    setRequesterId(null);
    setRequesterName(null);
  }, []);

  const value = useMemo<RequesterContextValue>(
    () => ({
      requesterId,
      requesterName,
      selectRequester,
      clearRequester,
    }),
    [requesterId, requesterName, selectRequester, clearRequester],
  );

  return (
    <RequesterContext.Provider value={value}>
      {children}
    </RequesterContext.Provider>
  );
}

export function useRequester(): RequesterContextValue {
  const context = useContext(RequesterContext);
  if (!context) {
    throw new Error("useRequester must be used within a RequesterProvider");
  }
  return context;
}
