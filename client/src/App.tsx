import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./routes/RequireAuth";
import { LoginScreen } from "./screens/LoginScreen";
import { ChangePasswordScreen } from "./screens/ChangePasswordScreen";
import { RequesterProvider } from "./requester/RequesterContext";
import { RequireRequester } from "./routes/RequireRequester";
import { RequesterSelectionScreen } from "./screens/RequesterSelectionScreen";
import { MyTicketsScreen } from "./screens/MyTicketsScreen";
import { CreateTicketScreen } from "./screens/CreateTicketScreen";
import { TicketDetailScreen } from "./screens/TicketDetailScreen";

/**
 * Client routing root (specification.md FR-01..FR-09). `AuthProvider` wraps
 * everything (not just the new routes) so `AppShell`'s `UserBadge` always
 * has real context to read, even on a screen this issue doesn't otherwise
 * touch — see UserBadge.tsx's doc comment.
 *
 * Scope note (#68, judgment call): only the two routes this issue actually
 * builds — `/login` (public) and `/change-password` (gated by
 * `RequireAuth`) — are wired onto real session auth here. The existing
 * Requester routes below (`/select-requester`, `/tickets`, `/tickets/new`,
 * `/tickets/:id`) are deliberately left exactly as Lab 2 built them, still
 * guarded only by `RequireRequester`/`X-Requester-Id` — gating them behind
 * `RequireAuth` too is explicitly issue #69/#70's job ("wiring ticket
 * routes to session identity", out of this issue's brief) and would also
 * break every existing Lab 2 client test that visits them without a
 * session (e.g. client/tests/lab-02/RequesterSelection.test.tsx). Until
 * that rewiring lands, a caller can still reach My Tickets/Create
 * Ticket/Ticket Detail via the old Development Requester selector even
 * after logging out of the new session — a known, flagged gap, not an
 * oversight.
 */
function App() {
  return (
    <AuthProvider>
      <RequesterProvider>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordScreen />
              </RequireAuth>
            }
          />
          <Route path="/" element={<Navigate to="/tickets" replace />} />
          <Route path="/select-requester" element={<RequesterSelectionScreen />} />
          <Route
            path="/tickets"
            element={
              <RequireRequester>
                <MyTicketsScreen />
              </RequireRequester>
            }
          />
          <Route
            path="/tickets/new"
            element={
              <RequireRequester>
                <CreateTicketScreen />
              </RequireRequester>
            }
          />
          <Route
            path="/tickets/:id"
            element={
              <RequireRequester>
                <TicketDetailScreen />
              </RequireRequester>
            }
          />
        </Routes>
      </RequesterProvider>
    </AuthProvider>
  );
}

export default App;
