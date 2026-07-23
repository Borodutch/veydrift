// Visible explanation for a blocked action. `title` tooltips never fire on
// disabled buttons (no mouse events) and don't exist on touch — render the
// reason inline instead so the "why" is always reachable.
export function ActionReasonNote({ reason }: { reason?: string | undefined }) {
  if (!reason) return null;
  return <span className="action-reason-note">{reason}</span>;
}
