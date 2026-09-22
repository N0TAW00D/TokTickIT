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
import { UserManagementScreen } from "./screens/UserManagementScreen";

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
 * `/staff/tickets/:id` (ui-spec.md §10, Issue #72) is `IT_STAFF`-only in
 * the UI, same as `/staff/tickets` above: the role-specific navigation
 * table (ui-spec.md §4.2) gives Administrator exactly one destination
 * (User Management), this screen is titled "Screen: IT Staff Ticket
 * Detail" and appears in no Administrator nav, and §4.3 says a role that
 * reaches a route it may not use gets the forbidden state, not the
 * screen. Don't conflate this with `GET /api/tickets/:id` also serving
 * ADMINISTRATOR reads (api-spec.md §5) — that's a fact about the read
 * API, not a grant of this UI route, and conflating the two is exactly
 * how an Administrator previously ended up on a screen whose Ticket
 * Owner/Status controls are IT_STAFF-only server-side and 403 on submit.
 * Everyone else (including an unauthenticated caller, or a REQUESTER) is
 * handled by `RequireRole` exactly as above.
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
            <RequireRole allowedRoles={["IT_STAFF"]}>
              <StaffTicketDetailScreen />
            </RequireRole>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireRole allowedRoles={["ADMINISTRATOR"]}>
              <UserManagementScreen />
            </RequireRole>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;
