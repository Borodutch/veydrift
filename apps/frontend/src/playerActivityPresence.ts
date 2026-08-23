export const MINIMUM_PLAYER_ACTIVITY_AWAY_WINDOW_SECONDS = 90;

/** Ignore short gaps caused by remounts, reconnects, or another active tab. */
export function playerActivityAwaySince(presence: {
  lastSeenAt: string;
  previousLastSeenAt: string | null;
}): number | undefined {
  const previous = presence.previousLastSeenAt === null ? undefined : Number(presence.previousLastSeenAt);
  const current = Number(presence.lastSeenAt);
  if (
    !Number.isSafeInteger(previous)
    || previous === undefined
    || previous <= 0
    || !Number.isSafeInteger(current)
    || current - previous < MINIMUM_PLAYER_ACTIVITY_AWAY_WINDOW_SECONDS
  ) {
    return undefined;
  }
  return previous;
}
