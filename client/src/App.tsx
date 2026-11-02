import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./routes/RequireAuth";
import { RequireRole } from "./routes/RequireRole";
import { RoleLandingRedirect } from "./routes/RoleLandingRedirect";
import { LoginScreen } from "./screens/LoginScreen";
import { ChangePasswordScreen } from "./screens/ChangePasswordScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
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
 * - `/dashboard` (lab-04 ui-spec.md §2) is one route for every role behind
 *   `RequireAuth`; `DashboardScreen` picks the Requester or staff variant
 *   from the session. `/` redirects there (D-12).
 * - Requester routes (`/tickets`, `/tickets/new`, `/tickets/:id`) are
 *   `RequireRole(['REQUESTER'])`: no session -> Login, the wrong role -> the
 *   forbidden state, and only a Requester ever mounts those screens.
 * - `/staff/tickets` and `/staff/tickets/:id` allow `IT_STAFF` and
 *   `ADMINISTRATOR` (lab-04 D-13: an Administrator reads the queue and opens
 *   a Ticket; status, claim and notes stay IT-Staff-only server-side).
 * - `/admin/users` is `ADMINISTRATOR` only.
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
        <Route path="/" element={<RoleLandingRedirect />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardScreen />
            </RequireAuth>
          }
        />
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
            <RequireRole allowedRoles={["IT_STAFF", "ADMINISTRATOR"]}>
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
