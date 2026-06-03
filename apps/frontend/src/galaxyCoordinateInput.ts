export function sanitizeCoordinateDraft(value: string): string {
  return value.replace(/\D/g, "");
}

export function parseCoordinateDraft(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function commitCoordinateDraft(
  draft: string,
  currentValue: number,
  max: number
): { draft: string; value: number | null } {
  const parsed = parseCoordinateDraft(draft);

  if (parsed === null) {
    return { draft: String(currentValue), value: null };
  }

  const nextValue = clampInteger(parsed, 1, max);
  return {
    draft: String(nextValue),
    value: nextValue === currentValue ? null : nextValue,
  };
}

export function coordinateDraftAfterExternalValueChange(
  currentDraft: string,
  externalValue: number,
  focused: boolean
): string {
  return focused ? currentDraft : String(externalValue);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
