import { AppShell } from "../shell/AppShell";

/**
 * Placeholder for the Create Ticket form (ui-spec.md §8). The real form is
 * built in Issue #16; this slice only needs a route + shell.
 */
export function CreateTicketScreen() {
  return (
    <AppShell>
      <h1>Create Ticket</h1>
      <p>The create-ticket form is coming in a later slice.</p>
    </AppShell>
  );
}
