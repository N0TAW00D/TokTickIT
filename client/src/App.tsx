import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./routes/RequireAuth";
import { RequireRole } from "./routes/RequireRole";
import { LoginScreen } from "./screens/LoginScreen";
import { ChangePasswordScreen } from "./screens/ChangePasswordScreen";
import { MyTicketsScreen } from "./screens/MyTicketsScreen";
import { CreateTicketScreen } from "./screens/CreateTicketScreen";
import { TicketDetailScreen } from "./screens/TicketDetailScreen";

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
      </Routes>
    </AuthProvider>
  );
}

export default App;
