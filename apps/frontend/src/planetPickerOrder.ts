const PLANET_PICKER_ORDER_STORAGE_PREFIX = "veydrift.planet-picker-order.v1:";
export const PLANET_PICKER_LONG_PRESS_MS = 500;
export const PLANET_PICKER_PRESS_MOVE_TOLERANCE_PX = 6;

type PlanetPickerOrderRecord = {
  planetIds: string[];
  version: 1;
};

type PlanetPickerOrderStorage = Pick<Storage, "getItem" | "setItem">;

export type PlanetPickerDropPosition = "after" | "before";
export type PlanetPickerLayout = "mobile" | "sidebar";

export type PlanetPickerTouchMoveGuard = {
  dispose(): void;
  setActive(active: boolean): void;
};

export type PlanetPickerPointerMoveResult =
  | { status: "dragging"; dragStarted: boolean; planetId: string }
  | { status: "cancelled"; planetId: string }
  | { status: "ignored" }
  | { status: "pending"; planetId: string };

export type PlanetPickerKeyboardReorderResult = {
  handled: boolean;
  nextPlanetIds: string[];
};

export type PlanetPickerInteractionController = {
  activatePointer(pointerId: number): { activated: boolean; planetId?: string };
  beginPointer(input: {
    button: number;
    clientX: number;
    clientY: number;
    orderIds: readonly string[];
    planetId: string;
    pointerId: number;
    pointerType?: string;
  }): boolean;
  cancelPointer(pointerId?: number): PlanetPickerPointerFinishResult;
  finishPointer(pointerId: number): PlanetPickerPointerFinishResult;
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

export type PlanetPickerPointerFinishResult = {
  finished: boolean;
  planetId?: string;
  wasDragging: boolean;
};

type PlanetPickerInteractionOptions = {
  longPressDelayMs?: number;
  moveTolerancePx?: number;
  now?: () => number;
};

export function installPlanetPickerTouchMoveGuard(
  target: EventTarget,
  isActive?: () => boolean,
): PlanetPickerTouchMoveGuard {
  let active = false;
  const handleTouchStart: EventListener = () => {
    // The non-passive listener marks this target as main-thread touch-handled
    // before Chromium decides whether subsequent moves may scroll.
  };
  const handleTouchMove: EventListener = (event) => {
    if ((isActive?.() ?? active) && event.cancelable) event.preventDefault();
  };

  // These listeners must exist before the touch starts. The browser decides
  // whether a gesture may pan at gesture start, so adding touch-action:none or
  // a touch listener only after the long press is too late for that gesture.
  target.addEventListener("touchstart", handleTouchStart, { passive: false });
  target.addEventListener("touchmove", handleTouchMove, { passive: false });

  return {
    dispose() {
      active = false;
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchmove", handleTouchMove);
    },
    setActive(nextActive) {
      active = nextActive;
    },
  };
}

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
  options: PlanetPickerInteractionOptions = {},
): PlanetPickerInteractionController {
  const longPressDelayMs = options.longPressDelayMs ?? PLANET_PICKER_LONG_PRESS_MS;
  const moveTolerancePx = options.moveTolerancePx ?? PLANET_PICKER_PRESS_MOVE_TOLERANCE_PX;
  const now = options.now ?? (() => (
    typeof performance === "undefined" ? Date.now() : performance.now()
  ));
  let pointerDrag: {
    activated: boolean;
    orderIds: string[];
    planetId: string;
    pointerId: number;
    pointerType: string;
    startedAt: number;
    startX: number;
    startY: number;
  } | undefined;

  function finishPointer(pointerId?: number): PlanetPickerPointerFinishResult {
    if (!pointerDrag || (pointerId !== undefined && pointerDrag.pointerId !== pointerId)) {
      return { finished: false, wasDragging: false };
    }

    const result = {
      finished: true,
      planetId: pointerDrag.planetId,
      wasDragging: pointerDrag.activated,
    };
    pointerDrag = undefined;
    return result;
  }

  return {
    activatePointer(pointerId) {
      if (
        !pointerDrag
        || pointerDrag.pointerId !== pointerId
        || now() - pointerDrag.startedAt < longPressDelayMs
      ) {
        return { activated: false };
      }

      pointerDrag.activated = true;
      return { activated: true, planetId: pointerDrag.planetId };
    },

    beginPointer(input) {
      const orderIds = uniquePlanetIds(input.orderIds);
      if (pointerDrag || input.button !== 0 || !orderIds.includes(input.planetId)) return false;

      pointerDrag = {
        activated: false,
        orderIds,
        planetId: input.planetId,
        pointerId: input.pointerId,
        pointerType: input.pointerType ?? "mouse",
        startedAt: now(),
        startX: input.clientX,
        startY: input.clientY,
      };
      return true;
    },

    cancelPointer: finishPointer,
    finishPointer,

    movePointer(input) {
      if (!pointerDrag || pointerDrag.pointerId !== input.pointerId) {
        return { status: "ignored" };
      }
      if (input.pointerType && input.pointerType !== pointerDrag.pointerType) {
        return { status: "ignored" };
      }

      if (!pointerDrag.activated) {
        if (!shouldStartPlanetPickerDrag(
          input.clientX - pointerDrag.startX,
          input.clientY - pointerDrag.startY,
          moveTolerancePx,
        )) {
          return { status: "pending", planetId: pointerDrag.planetId };
        }
        const planetId = pointerDrag.planetId;
        pointerDrag = undefined;
        return { status: "cancelled", planetId };
      }

      return { status: "dragging", dragStarted: true, planetId: pointerDrag.planetId };
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
      if (!drag?.activated || targetPlanetId === drag.planetId) return undefined;

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
