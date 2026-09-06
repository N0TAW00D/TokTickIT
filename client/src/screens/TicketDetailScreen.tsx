import { useParams } from "react-router-dom";
import { AppShell } from "../shell/AppShell";

/**
 * Placeholder for the Requester Ticket Detail view (ui-spec.md §10). The
 * real read-only header + attachments UI is built in Issue #19; this slice
 * only needs a route + shell.
 */
export function TicketDetailScreen() {
  const { id } = useParams();

  return (
    <AppShell>
      <h1>Ticket Details</h1>
      <p>Ticket {id} — detail view is coming in a later slice.</p>
    </AppShell>
  );
}
