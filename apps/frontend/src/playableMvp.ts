export type Resources = {
  metal: number;
  crystal: number;
  deuterium: number;
};

export type BuildingKey =
  | "metalMine"
  | "crystalMine"
  | "deuteriumSynthesizer"
  | "solarPlant"
  | "roboticsFactory"
  | "shipyard"
  | "researchLab"
  | "metalStorage"
  | "crystalStorage"
  | "deuteriumTank";

export type ShipKey = "smallCargo" | "lightFighter" | "colonyShip";
export type ResearchKey = "orbitalCartography" | "baseRelaySecurity";

export type MainQueueItem =
  | {
      kind: "building";
      key: BuildingKey;
      label: string;
      readyAt: number;
      startedAt: number;
      targetLevel: number;
    }
  | {
      kind: "ship";
      key: ShipKey;
      label: string;
      quantity: number;
      readyAt: number;
      startedAt: number;
    };

export type ResearchQueueItem = {
  kind: "research";
  key: ResearchKey;
  label: string;
  readyAt: number;
  startedAt: number;
  targetLevel: number;
};

export type QueueItem = MainQueueItem | ResearchQueueItem;

export type PlayableState = {
  resources: Resources;
  buildings: Record<BuildingKey, number>;
  research: Record<ResearchKey, number>;
  ships: Record<ShipKey, number>;
  queue?: MainQueueItem | undefined;
  researchQueue?: ResearchQueueItem | undefined;
  lastSettledAt: number;
};

export const buildingCatalog: Array<{
  key: BuildingKey;
  label: string;
  baseCost: Resources;
  asset: string;
}> = [
  {
    key: "metalMine",
    label: "Metal Mine",
    baseCost: { metal: 60, crystal: 15, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/metal-mine-mid.webp",
  },
  {
    key: "crystalMine",
    label: "Crystal Mine",
    baseCost: { metal: 48, crystal: 24, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/crystal-mine-mid.webp",
  },
  {
    key: "deuteriumSynthesizer",
    label: "Deuterium Synth",
    baseCost: { metal: 225, crystal: 75, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/deuterium-synthesizer-mid.webp",
  },
  {
    key: "solarPlant",
    label: "Solar Plant",
    baseCost: { metal: 75, crystal: 30, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/solar-plant-mid.webp",
  },
  {
    key: "roboticsFactory",
    label: "Robotics Factory",
    baseCost: { metal: 400, crystal: 120, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/robotics-factory-mid.webp",
  },
  {
    key: "shipyard",
    label: "Shipyard",
    baseCost: { metal: 400, crystal: 200, deuterium: 100 },
    asset: "/assets/game/style-pass/generated/buildings/shipyard-mid.webp",
  },
  {
    key: "researchLab",
    label: "Research Lab",
    baseCost: { metal: 200, crystal: 400, deuterium: 200 },
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "metalStorage",
    label: "Metal Storage",
    baseCost: { metal: 1_000, crystal: 0, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/metal-storage-mid.webp",
  },
  {
    key: "crystalStorage",
    label: "Crystal Storage",
    baseCost: { metal: 1_000, crystal: 500, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/crystal-storage-mid.webp",
  },
  {
    key: "deuteriumTank",
    label: "Deuterium Tank",
    baseCost: { metal: 1_000, crystal: 1_000, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/deuterium-tank-mid.webp",
  },
];

export const shipCatalog: Array<{
  key: ShipKey;
  label: string;
  baseCost: Resources;
  asset: string;
}> = [
  {
    key: "smallCargo",
    label: "Small Cargo",
    baseCost: { metal: 2_000, crystal: 2_000, deuterium: 0 },
    asset: "/assets/game/style-pass/high-res/small-cargo-alive-fullship-2k.webp",
  },
  {
    key: "lightFighter",
    label: "Light Fighter",
    baseCost: { metal: 3_000, crystal: 1_000, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/ships/light-fighter.webp",
  },
  {
    key: "colonyShip",
    label: "Colony Ship",
    baseCost: { metal: 10_000, crystal: 20_000, deuterium: 10_000 },
    asset: "/assets/game/style-pass/generated/ships/colony-ship.webp",
  },
];

export const researchCatalog: Array<{
  key: ResearchKey;
  label: string;
  lane: string;
  baseCost: Resources;
  asset: string;
}> = [
  {
    key: "orbitalCartography",
    label: "Orbital Cartography",
    lane: "Exploration",
    baseCost: { metal: 160, crystal: 120, deuterium: 0 },
    asset: "/assets/game/buildings/research-lab-mid.webp",
  },
  {
    key: "baseRelaySecurity",
    label: "Base Relay Security",
    lane: "Network",
    baseCost: { metal: 120, crystal: 180, deuterium: 40 },
    asset: "/assets/game/buildings/robotics-factory-mid.webp",
  },
];

const BPS = 10_000;
const MIN_QUEUE_SECONDS = 60;
const PLANET = {
  fields: 206,
  temperature: -12,
  metalMultiplierBps: 9_772,
  crystalMultiplierBps: 10_218,
  deuteriumMultiplierBps: 10_596,
};

export function createInitialPlayableState(now = Date.now()): PlayableState {
  return {
    resources: { metal: 5_000, crystal: 5_000, deuterium: 5_000 },
    buildings: {
      metalMine: 0,
      crystalMine: 0,
      deuteriumSynthesizer: 0,
      solarPlant: 0,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      metalStorage: 0,
      crystalStorage: 0,
      deuteriumTank: 0,
    },
    research: {
      orbitalCartography: 0,
      baseRelaySecurity: 0,
    },
    ships: {
      smallCargo: 0,
      lightFighter: 0,
      colonyShip: 0,
    },
    lastSettledAt: now,
  };
}

export function productionPerHour(buildings: Record<BuildingKey, number>): Resources {
  const requiredEnergy = (
    buildings.metalMine * 10
    + buildings.crystalMine * 12
    + buildings.deuteriumSynthesizer * 20
  );
  const producedEnergy = buildings.solarPlant * 30;
  const energyScale = requiredEnergy === 0 || producedEnergy >= requiredEnergy
    ? BPS
    : Math.floor((producedEnergy * BPS) / requiredEnergy);

  return {
    metal: scaleByBps(
      scaleByBps(
        30 + buildings.metalMine * 20 + buildings.metalMine * buildings.metalMine * 5,
        PLANET.metalMultiplierBps,
      ),
      energyScale,
    ),
    crystal: scaleByBps(
      scaleByBps(
        15 + buildings.crystalMine * 15 + buildings.crystalMine * buildings.crystalMine * 4,
        PLANET.crystalMultiplierBps,
      ),
      energyScale,
    ),
    deuterium: scaleByBps(
      scaleByBps(
        8
          + buildings.deuteriumSynthesizer * 10
          + buildings.deuteriumSynthesizer * buildings.deuteriumSynthesizer * 3,
        PLANET.deuteriumMultiplierBps,
      ),
      energyScale,
    ),
  };
}

export function storageCaps(buildings: Record<BuildingKey, number>): Resources {
  return {
    metal: 10_000 + buildings.metalStorage * 10_000,
    crystal: 10_000 + buildings.crystalStorage * 10_000,
    deuterium: 10_000 + buildings.deuteriumTank * 10_000,
  };
}

export function buildingCost(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
): Resources {
  const entry = buildingCatalog.find((item) => item.key === key);
  if (!entry) {
    throw new Error(`Unknown building: ${key}`);
  }

  return scaleByLevel(entry.baseCost, buildings[key]);
}

export function researchCost(
  research: Record<ResearchKey, number>,
  key: ResearchKey,
): Resources {
  const entry = researchCatalog.find((item) => item.key === key);
  if (!entry) {
    throw new Error(`Unknown research: ${key}`);
  }

  return scaleByLevel(entry.baseCost, research[key]);
}

export function canAfford(resources: Resources, cost: Resources): boolean {
  return resources.metal >= cost.metal
    && resources.crystal >= cost.crystal
    && resources.deuterium >= cost.deuterium;
}

export function settleState(state: PlayableState, now = Date.now()): PlayableState {
  const elapsedSeconds = Math.max(0, Math.floor((now - state.lastSettledAt) / 1_000));
  const rates = productionPerHour(state.buildings);
  const caps = storageCaps(state.buildings);
  const settled: PlayableState = {
    ...state,
    resources: {
      metal: Math.min(caps.metal, state.resources.metal + Math.floor((rates.metal * elapsedSeconds) / 3_600)),
      crystal: Math.min(caps.crystal, state.resources.crystal + Math.floor((rates.crystal * elapsedSeconds) / 3_600)),
      deuterium: Math.min(caps.deuterium, state.resources.deuterium + Math.floor((rates.deuterium * elapsedSeconds) / 3_600)),
    },
    lastSettledAt: now,
  };

  let next = settled;

  if (settled.queue && settled.queue.readyAt <= now) {
    if (settled.queue.kind === "building") {
      next = {
        ...settled,
        buildings: {
          ...settled.buildings,
          [settled.queue.key]: settled.queue.targetLevel,
        },
        queue: undefined,
      };
    } else {
      next = {
        ...settled,
        ships: {
          ...settled.ships,
          [settled.queue.key]: settled.ships[settled.queue.key] + settled.queue.quantity,
        },
        queue: undefined,
      };
    }
  }

  if (!next.researchQueue || next.researchQueue.readyAt > now) {
    return next;
  }

  if (next.researchQueue.kind !== "research") {
    return next;
  }

  return {
    ...next,
    research: {
      ...next.research,
      [next.researchQueue.key]: next.researchQueue.targetLevel,
    },
    researchQueue: undefined,
  };
}

export function startBuildingUpgrade(
  state: PlayableState,
  key: BuildingKey,
  now = Date.now(),
): PlayableState {
  const settled = settleState(state, now);
  if (settled.queue) {
    return settled;
  }

  const entry = buildingCatalog.find((item) => item.key === key);
  if (!entry) {
    return settled;
  }

  const cost = buildingCost(settled.buildings, key);
  if (!canAfford(settled.resources, cost)) {
    return settled;
  }

  const readyAt = now + buildingDurationSeconds(settled.buildings.roboticsFactory, cost) * 1_000;
  return {
    ...settled,
    resources: spend(settled.resources, cost),
    queue: {
      kind: "building",
      key,
      label: entry.label,
      readyAt,
      startedAt: now,
      targetLevel: settled.buildings[key] + 1,
    },
  };
}

export function startShipProduction(
  state: PlayableState,
  key: ShipKey,
  quantity = 1,
  now = Date.now(),
): PlayableState {
  const settled = settleState(state, now);
  if (settled.queue || settled.buildings.shipyard === 0) {
    return settled;
  }

  const entry = shipCatalog.find((item) => item.key === key);
  if (!entry) {
    return settled;
  }

  const cost = multiply(entry.baseCost, quantity);
  if (!canAfford(settled.resources, cost)) {
    return settled;
  }

  const readyAt = now + unitDurationSeconds(settled.buildings.shipyard, cost, quantity) * 1_000;
  return {
    ...settled,
    resources: spend(settled.resources, cost),
    queue: {
      kind: "ship",
      key,
      label: entry.label,
      quantity,
      readyAt,
      startedAt: now,
    },
  };
}

export function startResearch(
  state: PlayableState,
  key: ResearchKey,
  now = Date.now(),
): PlayableState {
  const settled = settleState(state, now);
  if (settled.researchQueue) {
    return settled;
  }

  const entry = researchCatalog.find((item) => item.key === key);
  if (!entry) {
    return settled;
  }

  const cost = researchCost(settled.research, key);
  if (!canAfford(settled.resources, cost)) {
    return settled;
  }

  const readyAt = now + researchDurationSeconds(settled.buildings.researchLab, cost) * 1_000;
  return {
    ...settled,
    resources: spend(settled.resources, cost),
    researchQueue: {
      kind: "research",
      key,
      label: entry.label,
      readyAt,
      startedAt: now,
      targetLevel: settled.research[key] + 1,
    },
  };
}

export function progress(queue: QueueItem | undefined, now = Date.now()): number {
  if (!queue) {
    return 0;
  }

  const total = queue.readyAt - queue.startedAt;
  const elapsed = now - queue.startedAt;
  return Math.min(1, Math.max(0, elapsed / total));
}

export function planetSummary() {
  return PLANET;
}

function scaleByLevel(cost: Resources, currentLevel: number): Resources {
  return multiply(cost, 2 ** currentLevel);
}

function buildingDurationSeconds(roboticsLevel: number, cost: Resources): number {
  const raw = Math.floor((cost.metal + cost.crystal) / (100 * (roboticsLevel + 1)));
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function unitDurationSeconds(shipyardLevel: number, cost: Resources, quantity: number): number {
  const raw = Math.floor(
    (cost.metal + cost.crystal + cost.deuterium) / (200 * (shipyardLevel + 1)),
  ) + quantity * 10;
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function researchDurationSeconds(researchLabLevel: number, cost: Resources): number {
  const raw = Math.floor((cost.metal + cost.crystal + cost.deuterium) / (110 * (researchLabLevel + 1)));
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function scaleByBps(value: number, multiplierBps: number): number {
  return Math.floor((value * multiplierBps) / BPS);
}

function multiply(resources: Resources, quantity: number): Resources {
  return {
    metal: resources.metal * quantity,
    crystal: resources.crystal * quantity,
    deuterium: resources.deuterium * quantity,
  };
}

function spend(resources: Resources, cost: Resources): Resources {
  return {
    metal: resources.metal - cost.metal,
    crystal: resources.crystal - cost.crystal,
    deuterium: resources.deuterium - cost.deuterium,
  };
}
