const PLANET_PICKER_ORDER_STORAGE_PREFIX = "veydrift.planet-picker-order.v1:";

type PlanetPickerOrderRecord = {
  planetIds: string[];
  version: 1;
};

type PlanetPickerOrderStorage = Pick<Storage, "getItem" | "setItem">;

export type PlanetPickerDropPosition = "after" | "before";

export function planetPickerWalletKey(wallet: string | null | undefined): string {
  return wallet?.trim().toLowerCase() ?? "";
}

export function planetPickerOrderStorageKey(wallet: string): string {
  return `${PLANET_PICKER_ORDER_STORAGE_PREFIX}${planetPickerWalletKey(wallet)}`;
}

export function readPlanetPickerOrder(
  storage: PlanetPickerOrderStorage | null | undefined,
  wallet: string | null | undefined,
): string[] | undefined {
  const walletKey = planetPickerWalletKey(wallet);
  if (!storage || !walletKey) return undefined;

  try {
    const raw = storage.getItem(planetPickerOrderStorageKey(walletKey));
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as Partial<PlanetPickerOrderRecord>;
    if (parsed.version !== 1 || !isValidPlanetIdOrder(parsed.planetIds)) return undefined;
    return parsed.planetIds;
  } catch {
    return undefined;
  }
}

export function writePlanetPickerOrder(
  storage: PlanetPickerOrderStorage | null | undefined,
  wallet: string | null | undefined,
  planetIds: readonly string[],
): void {
  const walletKey = planetPickerWalletKey(wallet);
  if (!storage || !walletKey || !isValidPlanetIdOrder(planetIds)) return;

  try {
    const record: PlanetPickerOrderRecord = { planetIds: [...planetIds], version: 1 };
    storage.setItem(planetPickerOrderStorageKey(walletKey), JSON.stringify(record));
  } catch {
    // Keep the in-memory order when browser storage is blocked or full.
  }
}

export function browserPlanetPickerOrderStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function reconcilePlanetPickerOrder(
  currentPlanetIds: readonly string[],
  savedPlanetIds: readonly string[] | undefined,
): string[] {
  const current = uniquePlanetIds(currentPlanetIds);
  if (!savedPlanetIds || !isValidPlanetIdOrder(savedPlanetIds)) return current;

  const currentSet = new Set(current);
  const savedCurrent = savedPlanetIds.filter((planetId) => currentSet.has(planetId));
  const savedSet = new Set(savedCurrent);
  return [...savedCurrent, ...current.filter((planetId) => !savedSet.has(planetId))];
}

export function reorderPlanetPickerIds(
  planetIds: readonly string[],
  sourcePlanetId: string,
  targetPlanetId: string,
  position: PlanetPickerDropPosition,
): string[] {
  const current = uniquePlanetIds(planetIds);
  if (sourcePlanetId === targetPlanetId) return current;
  if (!current.includes(sourcePlanetId) || !current.includes(targetPlanetId)) return current;

  const withoutSource = current.filter((planetId) => planetId !== sourcePlanetId);
  const targetIndex = withoutSource.indexOf(targetPlanetId);
  const insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  withoutSource.splice(insertionIndex, 0, sourcePlanetId);
  return withoutSource;
}

export function movePlanetPickerIdToIndex(
  planetIds: readonly string[],
  planetId: string,
  requestedIndex: number,
): string[] {
  const current = uniquePlanetIds(planetIds);
  const sourceIndex = current.indexOf(planetId);
  if (sourceIndex < 0 || current.length < 2) return current;

  const destinationIndex = Math.max(0, Math.min(current.length - 1, requestedIndex));
  if (sourceIndex === destinationIndex) return current;

  current.splice(sourceIndex, 1);
  current.splice(destinationIndex, 0, planetId);
  return current;
}

export function shouldStartPlanetPickerDrag(
  deltaX: number,
  deltaY: number,
  threshold = 6,
): boolean {
  return Math.hypot(deltaX, deltaY) >= threshold;
}

function isValidPlanetIdOrder(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((planetId) => typeof planetId === "string" && planetId.trim() === planetId && planetId.length > 0)) {
    return false;
  }
  return new Set(value).size === value.length;
}

function uniquePlanetIds(planetIds: readonly string[]): string[] {
  return [...new Set(planetIds.filter((planetId) => planetId.length > 0))];
}
