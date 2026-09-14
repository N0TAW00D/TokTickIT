import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "./api";

export interface AuthContextValue {
  /** The authenticated user, or null until confirmed (see RequireAuth, which does that confirmation). */
  user: AuthUser | null;
  /** Replaces the held user — called after a successful login/`/me` fetch, or with `null` on logout. */
  setUser: (user: AuthUser | null) => void;
  /** Convenience for a partial update (e.g. clearing `mustChangePassword` after a successful change) without re-fetching `/me`. */
  patchUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Holds the authenticated user's identity client-side (specification.md
 * §8.2, api-spec.md §1.2). There is no local persistence here (no
 * localStorage, unlike Lab 2's `RequesterContext`) — the real source of
 * truth is the server-side session cookie; this context is just a cache of
 * the last `GET /api/auth/me` (or login) response so screens don't have to
 * re-fetch it on every render. `RequireAuth` (../routes/RequireAuth.tsx) is
 * what (re)confirms it against the server, once per mount, exactly like
 * Lab 2's `RequireRequester` does for `requesterName`.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUserState] = useState<AuthUser | null>(null);

  const setUser = useCallback((next: AuthUser | null) => {
    setUserState(next);
  }, []);

  const patchUser = useCallback((patch: Partial<AuthUser>) => {
    setUserState((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, setUser, patchUser }),
    [user, setUser, patchUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Non-throwing variant of `useAuth`, for the one caller that must tolerate
 * being mounted outside an `AuthProvider`: `UserBadge`
 * (../shell/UserBadge.tsx), which `AppShell` renders unconditionally.
 * `AppShell` is exercised on its own (no `AuthProvider` in the tree) by
 * Lab 2's `client/tests/lab-02/AppShell.test.tsx` — that harness predates
 * Lab 3 and is out of this issue's scope to rewrite (its assertions are
 * about `RequesterBadge`/`RequesterContext`, unrelated to auth). Every real
 * mount of the app (`src/App.tsx`) wraps everything in `AuthProvider`, so
 * this only ever returns `null` in that one legacy test context — never in
 * production.
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext) ?? null;
}
