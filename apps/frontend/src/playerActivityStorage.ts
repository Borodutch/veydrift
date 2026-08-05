export const PLAYER_ACTIVITY_LAST_SEEN_PREFIX = "veydrift:player-activity:last-seen:v1";

export type PlayerActivityTimestampStorage = Pick<Storage, "getItem" | "setItem">;

export function playerActivityLastSeenKey(chainId: number, wallet: string): string {
  return `${PLAYER_ACTIVITY_LAST_SEEN_PREFIX}:${chainId}:${wallet.trim().toLowerCase()}`;
}

export function readPlayerActivityLastSeen(
  storage: PlayerActivityTimestampStorage | null | undefined,
  chainId: number,
  wallet: string
): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(playerActivityLastSeenKey(chainId, wallet));
    if (!raw || !/^\d+$/.test(raw)) return null;
    const timestamp = Number(raw);
    return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
  } catch {
    return null;
  }
}

export function writePlayerActivityLastSeen(
  storage: PlayerActivityTimestampStorage | null | undefined,
  chainId: number,
  wallet: string,
  timestamp: number
): void {
  if (!storage || !Number.isFinite(timestamp) || timestamp <= 0) return;
  try {
    storage.setItem(playerActivityLastSeenKey(chainId, wallet), String(Math.floor(timestamp)));
  } catch {
    // Private browsing and embedded webviews can reject storage writes.
  }
}

export function beginPlayerActivitySession(
  storage: PlayerActivityTimestampStorage | null | undefined,
  chainId: number,
  wallet: string,
  now: number
): number | null {
  const previous = readPlayerActivityLastSeen(storage, chainId, wallet);
  if (previous === null) writePlayerActivityLastSeen(storage, chainId, wallet, now);
  return previous;
}

export function browserPlayerActivityStorage(): PlayerActivityTimestampStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
