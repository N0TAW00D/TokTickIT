import type { ActionStatus } from "../tickets/actionsApi";
import "./ActionStatusBadge.css";

const PRESENTATION: Record<ActionStatus, { label: string; modifier: string }> = {
  PLANNED: { label: "Planned", modifier: "planned" },
  IN_PROGRESS: { label: "In progress", modifier: "progress" },
  COMPLETED: { label: "Completed", modifier: "done" },
  CANCELLED: { label: "Cancelled", modifier: "cancelled" },
};

export function getActionStatusLabel(value: string): string {
  return PRESENTATION[value as ActionStatus]?.label ?? value;
}

/** Action Taken status (ui-spec.md §1): a square 4px badge, never a pill, so it
 * is not mistaken for the Ticket `StatusBadge` whose wording overlaps. */
export function ActionStatusBadge({ value }: { value: ActionStatus | (string & {}) }) {
  const presentation = PRESENTATION[value as ActionStatus];
  const modifier = presentation?.modifier ?? "planned";
  return (
    <span className={`zen-action-status zen-action-status--${modifier}`}>
      {presentation?.label ?? value}
    </span>
  );
}
