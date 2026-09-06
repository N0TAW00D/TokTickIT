import { AppShell } from "../shell/AppShell";

/**
 * Placeholder for the My Tickets list (ui-spec.md §9). The real list,
 * search/filter/sort/pagination, and states are built in Issue #18; this
 * slice only needs a route + shell to exercise routing and the guard.
 */
export function MyTicketsScreen() {
  return (
    <AppShell>
      <h1>My Tickets</h1>
      <p>The ticket list is coming in a later slice.</p>
    </AppShell>
  );
}
