import "./Badge.css";
import "./RoleBadge.css";

export type RoleValue = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

const ROLE_LABEL: Record<RoleValue, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};

export interface RoleBadgeProps {
  value: RoleValue | (string & {});
}

/**
 * Role badge (ui-spec.md §3.3). All three roles share one background/text
 * pair (`--zen-role-bg`/`--zen-role-text`) — role is distinguished by its
 * label text, not by color, matching every other badge family's "text
 * always rendered" rule (ui-spec.md §3).
 */
export function RoleBadge({ value }: RoleBadgeProps) {
  const label = value in ROLE_LABEL ? ROLE_LABEL[value as RoleValue] : value;

  return (
    <span className="zen-badge zen-badge--role">
      <span className="zen-badge__label">{label}</span>
    </span>
  );
}
