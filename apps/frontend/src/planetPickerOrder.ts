const PLANET_PICKER_ORDER_STORAGE_PREFIX = "veydrift.planet-picker-order.v1:";

type PlanetPickerOrderRecord = {
  planetIds: string[];
  version: 1;
};

type PlanetPickerOrderStorage = Pick<Storage, "getItem" | "setItem">;

export type PlanetPickerDropPosition = "after" | "before";
export type PlanetPickerLayout = "mobile" | "sidebar";

export type PlanetPickerPointerMoveResult =
  | { status: "dragging"; dragStarted: boolean; planetId: string }
  | { status: "ignored" }
  | { status: "pending"; planetId: string };

export type PlanetPickerKeyboardReorderResult = {
  handled: boolean;
  nextPlanetIds: string[];
};

export type PlanetPickerInteractionController = {
  beginPointer(input: {
    button: number;
    clientX: number;
    clientY: number;
    orderIds: readonly string[];
    planetId: string;
    pointerId: number;
    pointerType?: string;
  }): boolean;
  finishPointer(pointerId: number): { finished: boolean; wasDragging: boolean };
  movePointer(input: {
    clientX: number;
    clientY: number;
    pointerId: number;
    pointerType?: string;
  }): PlanetPickerPointerMoveResult;
  reorderFromKey(
    planetIds: readonly string[],
    planetId: string,
    key: string,
  ): PlanetPickerKeyboardReorderResult;
  reorderPointerTarget(
    targetPlanetId: string,
    position: PlanetPickerDropPosition,
  ): { movedPlanetId: string; nextPlanetIds: string[] } | undefined;
};

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

export function planetPickerDropPosition(
  layout: PlanetPickerLayout,
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "height" | "left" | "top" | "width">,
): PlanetPickerDropPosition {
  if (layout === "mobile") {
    return clientX < bounds.left + bounds.width / 2 ? "before" : "after";
  }
  return clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

export function createPlanetPickerInteractionController(
  dragThreshold = 6,
): PlanetPickerInteractionController {
  let pointerDrag: {
    orderIds: string[];
    planetId: string;
    pointerId: number;
    pointerType: string;
    started: boolean;
    startX: number;
    startY: number;
  } | undefined;

  return {
    beginPointer(input) {
      const orderIds = uniquePlanetIds(input.orderIds);
      if (input.button !== 0 || !orderIds.includes(input.planetId)) return false;

      pointerDrag = {
        orderIds,
        planetId: input.planetId,
        pointerId: input.pointerId,
        pointerType: input.pointerType ?? "mouse",
        started: false,
        startX: input.clientX,
        startY: input.clientY,
      };
      return true;
    },

    finishPointer(pointerId) {
      if (!pointerDrag || pointerDrag.pointerId !== pointerId) {
        return { finished: false, wasDragging: false };
      }

      const wasDragging = pointerDrag.started;
      pointerDrag = undefined;
      return { finished: true, wasDragging };
    },

    movePointer(input) {
      if (!pointerDrag || pointerDrag.pointerId !== input.pointerId) {
        return { status: "ignored" };
      }
      if (input.pointerType && input.pointerType !== pointerDrag.pointerType) {
        return { status: "ignored" };
      }

      if (!pointerDrag.started) {
        if (!shouldStartPlanetPickerDrag(
          input.clientX - pointerDrag.startX,
          input.clientY - pointerDrag.startY,
          dragThreshold,
        )) {
          return { status: "pending", planetId: pointerDrag.planetId };
        }
        pointerDrag.started = true;
        return { status: "dragging", dragStarted: true, planetId: pointerDrag.planetId };
      }

      return { status: "dragging", dragStarted: false, planetId: pointerDrag.planetId };
    },

    reorderFromKey(planetIds, planetId, key) {
      const sourceIndex = planetIds.indexOf(planetId);
      let destinationIndex: number | undefined;
      if (key === "ArrowLeft" || key === "ArrowUp") destinationIndex = sourceIndex - 1;
      if (key === "ArrowRight" || key === "ArrowDown") destinationIndex = sourceIndex + 1;
      if (key === "Home") destinationIndex = 0;
      if (key === "End") destinationIndex = planetIds.length - 1;
      return {
        handled: destinationIndex !== undefined,
        nextPlanetIds: destinationIndex === undefined
          ? [...planetIds]
          : movePlanetPickerIdToIndex(planetIds, planetId, destinationIndex),
      };
    },

    reorderPointerTarget(targetPlanetId, position) {
      const drag = pointerDrag;
      if (!drag?.started || targetPlanetId === drag.planetId) return undefined;

      const nextPlanetIds = reorderPlanetPickerIds(
        drag.orderIds,
        drag.planetId,
        targetPlanetId,
        position,
      );
      if (nextPlanetIds.every((planetId, index) => planetId === drag.orderIds[index])) {
        return undefined;
      }

      drag.orderIds = nextPlanetIds;
      return { movedPlanetId: drag.planetId, nextPlanetIds };
    },
  };
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
