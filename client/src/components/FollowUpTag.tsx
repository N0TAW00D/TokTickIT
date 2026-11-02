import "./ActionStatusBadge.css";

/** "⚑ Follow-up" (lab-04/ui-spec.md §1): glyph plus text, shown only when follow-up is required. */
export function FollowUpTag() {
  return (
    <span className="zen-follow-up-tag">
      <span aria-hidden="true">⚑</span> Follow-up
    </span>
  );
}
