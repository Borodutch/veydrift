import type { MissionShips } from "./galaxyActions";

export function parseMoonJumpShips(smallCargoValue: string, largeCargoValue: string): Partial<MissionShips> | undefined | null {
  const smallCargo = parseMoonShipQuantity(smallCargoValue);
  const largeCargo = parseMoonShipQuantity(largeCargoValue);

  if (smallCargo === null || largeCargo === null) return null;

  return smallCargo > 0 || largeCargo > 0
    ? { smallCargo, largeCargo }
    : undefined;
}

export function isPositiveIntegerInput(value: string): boolean {
  return parseStrictPositiveInteger(value) !== null;
}

function parseStrictPositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseMoonShipQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
