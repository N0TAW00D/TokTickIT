import { Navigate, Route, Routes } from "react-router-dom";
import { RequesterProvider } from "./requester/RequesterContext";
import { RequireRequester } from "./routes/RequireRequester";
import { RequesterSelectionScreen } from "./screens/RequesterSelectionScreen";
import { MyTicketsScreen } from "./screens/MyTicketsScreen";
import { CreateTicketScreen } from "./screens/CreateTicketScreen";
import { TicketDetailScreen } from "./screens/TicketDetailScreen";

/**
 * Client routing root (specification.md FR-01..FR-05). Requester-scoped
 * routes are wrapped in the RequireRequester guard, which redirects to
 * `/select-requester` when there is no valid current Requester.
 */
function App() {
  return (
    <RequesterProvider>
      <Routes>
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
  );
}

export default App;
