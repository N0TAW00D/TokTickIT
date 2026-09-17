import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./routes/RequireAuth";
import { RequireRole } from "./routes/RequireRole";
import { LoginScreen } from "./screens/LoginScreen";
import { ChangePasswordScreen } from "./screens/ChangePasswordScreen";
import { MyTicketsScreen } from "./screens/MyTicketsScreen";
import { CreateTicketScreen } from "./screens/CreateTicketScreen";
import { TicketDetailScreen } from "./screens/TicketDetailScreen";
import { StaffTicketQueueScreen } from "./screens/StaffTicketQueueScreen";
import { StaffTicketDetailScreen } from "./screens/StaffTicketDetailScreen";

/**
 * Client routing root (specification.md FR-01..FR-09, FR-14..FR-18).
 * `AuthProvider` wraps everything so `AppShell`'s `UserBadge` always has
 * real context to read.
 *
 * Issue #70 rewires the Requester ticket routes (`/tickets`, `/tickets/new`,
 * `/tickets/:id`) off the Lab 2 Development Requester selector
 * (`RequesterProvider`/`RequireRequester`, both deleted) and onto real
 * session identity: `RequireRole(['REQUESTER'])` already wraps `RequireAuth`
 * internally (see RequireRole.tsx), so no session -> Login, a session with
 * the wrong role -> the forbidden state, and only an authenticated
 * Requester ever reaches these screens. `/select-requester` is gone with
 * the selector it served.
 *
 * `/staff/tickets` (ui-spec.md §9) follows the identical
 * `RequireRole(['IT_STAFF'])` pattern — an unauthenticated caller lands on
 * Login (via `RequireRole`'s internal `RequireAuth`) and an authenticated
 * non-IT_STAFF caller sees the forbidden state (ui-spec.md §4.3), never
 * `StaffTicketQueueScreen` itself.
 *
 * `/staff/tickets/:id` (ui-spec.md §10, Issue #72) is reachable by BOTH
 * `IT_STAFF` and `ADMINISTRATOR` — api-spec.md §5 gives Administrator a read
 * path here even though several write actions on this screen are denied to
 * them server-side. Everyone else (including an unauthenticated caller, or
 * a REQUESTER) is handled by `RequireRole` exactly as above.
 */
function App() {
  return (
    <AuthProvider>
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
        <Route
          path="/tickets"
          element={
            <RequireRole allowedRoles={["REQUESTER"]}>
              <MyTicketsScreen />
            </RequireRole>
          }
        />
        <Route
          path="/tickets/new"
          element={
            <RequireRole allowedRoles={["REQUESTER"]}>
              <CreateTicketScreen />
            </RequireRole>
          }
        />
        <Route
          path="/tickets/:id"
          element={
            <RequireRole allowedRoles={["REQUESTER"]}>
              <TicketDetailScreen />
            </RequireRole>
          }
        />
        <Route
          path="/staff/tickets"
          element={
            <RequireRole allowedRoles={["IT_STAFF"]}>
              <StaffTicketQueueScreen />
            </RequireRole>
          }
        />
        <Route
          path="/staff/tickets/:id"
          element={
            <RequireRole allowedRoles={["IT_STAFF", "ADMINISTRATOR"]}>
              <StaffTicketDetailScreen />
            </RequireRole>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;
