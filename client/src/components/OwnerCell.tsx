import "./Badge.css";

export interface OwnerCellProps {
  /** `null` means unassigned — the shape `GET /api/staff/tickets` sends (server/src/routes/staff.ts). */
  owner: { id: number; name: string } | null;
}

/**
 * Owner token (lab-03/ui-spec.md §3.4): an assigned ticket shows its
 * owner's name as plain text; an unassigned one shows a badge with the
 * literal text "Unassigned" in the dedicated unassigned colour pair. Both
 * branches carry `data-owner` — the observable AC-32 asserts — so the
 * assigned/unassigned distinction is testable without reading colour.
 */
export function OwnerCell({ owner }: OwnerCellProps) {
  if (owner) {
    return <span data-owner="assigned">{owner.name}</span>;
  }

  return (
    <span className="zen-badge zen-badge--unassigned" data-owner="unassigned">
      <span className="zen-badge__label">Unassigned</span>
    </span>
  );
}
