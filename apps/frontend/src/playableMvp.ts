import { defenseAssetByKey, shipAssetByKey } from "./gameAssets";

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

export const buildingContractIds: Record<BuildingKey, number> = {
  metalMine: 0,
  crystalMine: 1,
  deuteriumSynthesizer: 2,
  solarPlant: 3,
  roboticsFactory: 4,
  shipyard: 5,
  researchLab: 6,
  metalStorage: 7,
  crystalStorage: 8,
  deuteriumTank: 9,
};

export type ShipKey =
  | "smallCargo"
  | "lightFighter"
  | "recycler"
  | "colonyShip"
  | "largeCargo"
  | "heavyFighter"
  | "cruiser"
  | "battleship"
  | "espionageProbe"
  | "bomber"
  | "solarSatellite"
  | "destroyer"
  | "deathstar"
  | "battlecruiser"
  | "reaper"
  | "pathfinder";
export type DefenseKey =
  | "rocketLauncher"
  | "lightLaser"
  | "heavyLaser"
  | "smallShieldDome"
  | "gaussCannon"
  | "ionCannon"
  | "plasmaTurret"
  | "largeShieldDome"
  | "antiBallisticMissile"
  | "interplanetaryMissile";
export type ResearchKey =
  | "energy"
  | "laser"
  | "ion"
  | "combustionDrive"
  | "espionage"
  | "computer"
  | "weapons"
  | "shielding"
  | "armor"
  | "hyperspace"
  | "impulseDrive"
  | "hyperspaceDrive"
  | "plasma"
  | "astrophysics"
  | "intergalacticResearchNetwork"
  | "graviton";

export type ResearchRequirement =
  | {
      type: "building";
      key: BuildingKey;
      level: number;
    }
  | {
      type: "research";
      key: ResearchKey;
      level: number;
    };

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
  defenses: Record<DefenseKey, number>;
  queue?: MainQueueItem | undefined;
  researchQueue?: ResearchQueueItem | undefined;
  lastSettledAt: number;
};

export type EnergyBalance = {
  produced: number;
  required: number;
  scaleBps: number;
};

export type PlanetProductionProfile = {
  metalMultiplierBps: number;
  crystalMultiplierBps: number;
  deuteriumMultiplierBps: number;
};

export type BuildingEffectMetrics =
  | {
      kind: "production";
      resource: keyof Resources;
      currentPerHour: number;
      nextPerHour: number;
      deltaPerHour: number;
    }
  | {
      kind: "energy";
      currentProduced: number;
      nextProduced: number;
      deltaProduced: number;
      required: number;
    }
  | {
      kind: "storage";
      resource: keyof Resources;
      currentCapacity: number;
      nextCapacity: number;
      deltaCapacity: number;
    }
  | {
      kind: "constructionSpeed";
      currentFactor: number;
      nextFactor: number;
    }
  | {
      kind: "shipyard";
      currentFactor: number;
      nextFactor: number;
      unlocked: boolean;
      nextUnlocked: boolean;
    }
  | {
      kind: "researchSpeed";
      currentFactor: number;
      nextFactor: number;
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
  id: number;
  label: string;
  group: "civil" | "combat" | "special";
  baseCost: Resources;
  requirements: Array<{
    label: string;
    kind: "building" | "technology";
    key?: BuildingKey | ResearchKey;
    level: number;
  }>;
  asset: string;
}> = [
  {
    key: "smallCargo",
    id: 0,
    label: "Small Cargo",
    group: "civil",
    baseCost: { metal: 2_000, crystal: 2_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 1 },
    ],
    asset: shipAssetByKey.smallCargo,
  },
  {
    key: "lightFighter",
    id: 1,
    label: "Light Fighter",
    group: "combat",
    baseCost: { metal: 3_000, crystal: 1_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 1 },
    ],
    asset: shipAssetByKey.lightFighter,
  },
  {
    key: "recycler",
    id: 2,
    label: "Recycler",
    group: "civil",
    baseCost: { metal: 10_000, crystal: 6_000, deuterium: 2_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 2 },
    ],
    asset: shipAssetByKey.recycler,
  },
  {
    key: "colonyShip",
    id: 3,
    label: "Colony Ship",
    group: "civil",
    baseCost: { metal: 10_000, crystal: 20_000, deuterium: 10_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 3 },
    ],
    asset: shipAssetByKey.colonyShip,
  },
  {
    key: "largeCargo",
    id: 4,
    label: "Large Cargo",
    group: "civil",
    baseCost: { metal: 6_000, crystal: 6_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 6 },
    ],
    asset: shipAssetByKey.largeCargo,
  },
  {
    key: "heavyFighter",
    id: 5,
    label: "Heavy Fighter",
    group: "combat",
    baseCost: { metal: 6_000, crystal: 4_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 2 },
    ],
    asset: shipAssetByKey.heavyFighter,
  },
  {
    key: "cruiser",
    id: 6,
    label: "Cruiser",
    group: "combat",
    baseCost: { metal: 20_000, crystal: 7_000, deuterium: 2_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 4 },
    ],
    asset: shipAssetByKey.cruiser,
  },
  {
    key: "battleship",
    id: 7,
    label: "Battleship",
    group: "combat",
    baseCost: { metal: 45_000, crystal: 15_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 4 },
    ],
    asset: shipAssetByKey.battleship,
  },
  {
    key: "espionageProbe",
    id: 8,
    label: "Espionage Probe",
    group: "special",
    baseCost: { metal: 0, crystal: 1_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "espionage", label: "Espionage", level: 2 },
    ],
    asset: shipAssetByKey.espionageProbe,
  },
  {
    key: "bomber",
    id: 9,
    label: "Bomber",
    group: "combat",
    baseCost: { metal: 50_000, crystal: 25_000, deuterium: 15_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 6 },
    ],
    asset: shipAssetByKey.bomber,
  },
  {
    key: "solarSatellite",
    id: 10,
    label: "Solar Satellite",
    group: "special",
    baseCost: { metal: 0, crystal: 2_000, deuterium: 500 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
    ],
    asset: shipAssetByKey.solarSatellite,
  },
  {
    key: "destroyer",
    id: 11,
    label: "Destroyer",
    group: "combat",
    baseCost: { metal: 60_000, crystal: 50_000, deuterium: 15_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 6 },
    ],
    asset: shipAssetByKey.destroyer,
  },
  {
    key: "deathstar",
    id: 12,
    label: "Dreadstar",
    group: "special",
    baseCost: { metal: 5_000_000, crystal: 4_000_000, deuterium: 1_000_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "graviton", label: "Graviton", level: 1 },
    ],
    asset: shipAssetByKey.deathstar,
  },
  {
    key: "battlecruiser",
    id: 13,
    label: "Battlecruiser",
    group: "combat",
    baseCost: { metal: 30_000, crystal: 40_000, deuterium: 15_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 5 },
    ],
    asset: shipAssetByKey.battlecruiser,
  },
  {
    key: "reaper",
    id: 14,
    label: "Reaper",
    group: "combat",
    baseCost: { metal: 85_000, crystal: 55_000, deuterium: 20_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 7 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 6 },
    ],
    asset: shipAssetByKey.reaper,
  },
  {
    key: "pathfinder",
    id: 15,
    label: "Pathfinder",
    group: "special",
    baseCost: { metal: 8_000, crystal: 15_000, deuterium: 8_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 2 },
    ],
    asset: shipAssetByKey.pathfinder,
  },
];

export const defenseCatalog: Array<{
  key: DefenseKey;
  id: number;
  label: string;
  group: "kinetic" | "energy" | "shield" | "missile";
  baseCost: Resources;
  requirements: Array<{
    label: string;
    kind: "building" | "technology";
    key?: BuildingKey | ResearchKey;
    level: number;
  }>;
  asset: string;
}> = [
  {
    key: "rocketLauncher",
    id: 0,
    label: "Rocket Launcher",
    group: "kinetic",
    baseCost: { metal: 200, crystal: 0, deuterium: 0 },
    requirements: [{ kind: "building", key: "shipyard", label: "Shipyard", level: 1 }],
    asset: defenseAssetByKey.rocketLauncher,
  },
  {
    key: "lightLaser",
    id: 1,
    label: "Light Laser",
    group: "energy",
    baseCost: { metal: 1_500, crystal: 500, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "laser", label: "Laser", level: 1 },
    ],
    asset: defenseAssetByKey.lightLaser,
  },
  {
    key: "heavyLaser",
    id: 2,
    label: "Heavy Laser",
    group: "energy",
    baseCost: { metal: 6_000, crystal: 2_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "laser", label: "Laser", level: 3 },
    ],
    asset: defenseAssetByKey.heavyLaser,
  },
  {
    key: "smallShieldDome",
    id: 3,
    label: "Small Shield Dome",
    group: "shield",
    baseCost: { metal: 10_000, crystal: 10_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "shielding", label: "Shielding", level: 2 },
    ],
    asset: defenseAssetByKey.smallShieldDome,
  },
  {
    key: "gaussCannon",
    id: 4,
    label: "Gauss Cannon",
    group: "kinetic",
    baseCost: { metal: 20_000, crystal: 15_000, deuterium: 2_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "laser", label: "Laser", level: 6 },
      { kind: "technology", key: "shielding", label: "Shielding", level: 1 },
    ],
    asset: defenseAssetByKey.gaussCannon,
  },
  {
    key: "ionCannon",
    id: 5,
    label: "Ion Cannon",
    group: "energy",
    baseCost: { metal: 2_000, crystal: 6_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "ion", label: "Ion", level: 4 },
    ],
    asset: defenseAssetByKey.ionCannon,
  },
  {
    key: "plasmaTurret",
    id: 6,
    label: "Plasma Turret",
    group: "energy",
    baseCost: { metal: 50_000, crystal: 50_000, deuterium: 30_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "plasma", label: "Plasma", level: 7 },
    ],
    asset: defenseAssetByKey.plasmaTurret,
  },
  {
    key: "largeShieldDome",
    id: 7,
    label: "Large Shield Dome",
    group: "shield",
    baseCost: { metal: 50_000, crystal: 50_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "technology", key: "shielding", label: "Shielding", level: 6 },
    ],
    asset: defenseAssetByKey.largeShieldDome,
  },
  {
    key: "antiBallisticMissile",
    id: 8,
    label: "Anti-Ballistic Missile",
    group: "missile",
    baseCost: { metal: 8_000, crystal: 0, deuterium: 2_000 },
    requirements: [{ kind: "building", key: "shipyard", label: "Shipyard", level: 1 }],
    asset: defenseAssetByKey.antiBallisticMissile,
  },
  {
    key: "interplanetaryMissile",
    id: 9,
    label: "Interplanetary Missile",
    group: "missile",
    baseCost: { metal: 12_500, crystal: 2_500, deuterium: 10_000 },
    requirements: [{ kind: "building", key: "shipyard", label: "Shipyard", level: 1 }],
    asset: defenseAssetByKey.interplanetaryMissile,
  },
];

export const researchCatalog: Array<{
  key: ResearchKey;
  id: number;
  label: string;
  lane: string;
  baseCost: Resources;
  requirements?: ResearchRequirement[] | undefined;
  asset: string;
}> = [
  {
    key: "energy",
    id: 0,
    label: "Energy Technology",
    lane: "Basic",
    baseCost: { metal: 0, crystal: 800, deuterium: 400 },
    asset: "/assets/game/style-pass/generated/buildings/solar-plant-mid.webp",
  },
  {
    key: "laser",
    id: 1,
    label: "Laser Technology",
    lane: "Basic",
    baseCost: { metal: 200, crystal: 100, deuterium: 0 },
    requirements: [{ type: "research", key: "energy", level: 1 }],
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "ion",
    id: 2,
    label: "Ion Technology",
    lane: "Basic",
    baseCost: { metal: 1_000, crystal: 300, deuterium: 100 },
    requirements: [{ type: "research", key: "laser", level: 2 }],
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "hyperspace",
    id: 9,
    label: "Hyperspace Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 4_000, deuterium: 2_000 },
    requirements: [{ type: "research", key: "energy", level: 5 }],
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "plasma",
    id: 12,
    label: "Plasma Technology",
    lane: "Advanced",
    baseCost: { metal: 2_000, crystal: 4_000, deuterium: 1_000 },
    requirements: [
      { type: "research", key: "energy", level: 8 },
      { type: "research", key: "laser", level: 10 },
      { type: "research", key: "ion", level: 5 },
    ],
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "combustionDrive",
    id: 3,
    label: "Combustion Drive",
    lane: "Drive",
    baseCost: { metal: 400, crystal: 0, deuterium: 600 },
    asset: "/assets/game/style-pass/generated/buildings/shipyard-mid.webp",
  },
  {
    key: "impulseDrive",
    id: 10,
    label: "Impulse Drive",
    lane: "Drive",
    baseCost: { metal: 2_000, crystal: 4_000, deuterium: 600 },
    requirements: [{ type: "research", key: "energy", level: 1 }],
    asset: "/assets/game/style-pass/generated/buildings/shipyard-mid.webp",
  },
  {
    key: "hyperspaceDrive",
    id: 11,
    label: "Hyperspace Drive",
    lane: "Drive",
    baseCost: { metal: 10_000, crystal: 20_000, deuterium: 6_000 },
    requirements: [{ type: "research", key: "hyperspace", level: 3 }],
    asset: "/assets/game/style-pass/generated/buildings/shipyard-mid.webp",
  },
  {
    key: "espionage",
    id: 4,
    label: "Espionage Technology",
    lane: "Advanced",
    baseCost: { metal: 200, crystal: 1_000, deuterium: 200 },
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "computer",
    id: 5,
    label: "Computer Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 400, deuterium: 600 },
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "astrophysics",
    id: 13,
    label: "Astrophysics",
    lane: "Advanced",
    baseCost: { metal: 4_000, crystal: 8_000, deuterium: 4_000 },
    requirements: [
      { type: "research", key: "espionage", level: 4 },
      { type: "research", key: "impulseDrive", level: 3 },
    ],
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "intergalacticResearchNetwork",
    id: 14,
    label: "Intergalactic Research Network",
    lane: "Advanced",
    baseCost: { metal: 240_000, crystal: 400_000, deuterium: 160_000 },
    requirements: [
      { type: "research", key: "computer", level: 8 },
      { type: "research", key: "hyperspace", level: 8 },
    ],
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "graviton",
    id: 15,
    label: "Graviton Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 0, deuterium: 0 },
    requirements: [{ type: "research", key: "energy", level: 12 }],
    asset: "/assets/game/style-pass/generated/buildings/solar-plant-mid.webp",
  },
  {
    key: "weapons",
    id: 6,
    label: "Weapons Technology",
    lane: "Combat",
    baseCost: { metal: 800, crystal: 200, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/shipyard-mid.webp",
  },
  {
    key: "shielding",
    id: 7,
    label: "Shielding Technology",
    lane: "Combat",
    baseCost: { metal: 200, crystal: 600, deuterium: 0 },
    requirements: [{ type: "research", key: "energy", level: 1 }],
    asset: "/assets/game/style-pass/generated/buildings/research-lab-mid.webp",
  },
  {
    key: "armor",
    id: 8,
    label: "Armor Technology",
    lane: "Combat",
    baseCost: { metal: 1_000, crystal: 0, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/metal-mine-mid.webp",
  },
];

const BASE_RESEARCH_REQUIREMENTS: ResearchRequirement[] = [
  { type: "building", key: "researchLab", level: 1 },
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
      energy: 0,
      laser: 0,
      ion: 0,
      combustionDrive: 0,
      espionage: 0,
      computer: 0,
      weapons: 0,
      shielding: 0,
      armor: 0,
      hyperspace: 0,
      impulseDrive: 0,
      hyperspaceDrive: 0,
      plasma: 0,
      astrophysics: 0,
      intergalacticResearchNetwork: 0,
      graviton: 0,
    },
    ships: {
      smallCargo: 0,
      lightFighter: 0,
      recycler: 0,
      colonyShip: 0,
      largeCargo: 0,
      heavyFighter: 0,
      cruiser: 0,
      battleship: 0,
      espionageProbe: 0,
      bomber: 0,
      solarSatellite: 0,
      destroyer: 0,
      deathstar: 0,
      battlecruiser: 0,
      reaper: 0,
      pathfinder: 0,
    },
    defenses: {
      rocketLauncher: 0,
      lightLaser: 0,
      heavyLaser: 0,
      smallShieldDome: 0,
      gaussCannon: 0,
      ionCannon: 0,
      plasmaTurret: 0,
      largeShieldDome: 0,
      antiBallisticMissile: 0,
      interplanetaryMissile: 0,
    },
    lastSettledAt: now,
  };
}

export function productionPerHour(
  buildings: Record<BuildingKey, number>,
  profile: PlanetProductionProfile = PLANET,
): Resources {
  const energy = energyBalance(buildings);

  const capacity = productionCapacityPerHour(buildings, profile);

  return {
    metal: scaleByBps(capacity.metal, energy.scaleBps),
    crystal: scaleByBps(capacity.crystal, energy.scaleBps),
    deuterium: scaleByBps(capacity.deuterium, energy.scaleBps),
  };
}

export function productionCapacityPerHour(
  buildings: Record<BuildingKey, number>,
  profile: PlanetProductionProfile = PLANET,
): Resources {
  return {
    metal: scaleByBps(
      30 + buildings.metalMine * 20 + buildings.metalMine * buildings.metalMine * 5,
      profile.metalMultiplierBps,
    ),
    crystal: scaleByBps(
      15 + buildings.crystalMine * 15 + buildings.crystalMine * buildings.crystalMine * 4,
      profile.crystalMultiplierBps,
    ),
    deuterium: scaleByBps(
      8
        + buildings.deuteriumSynthesizer * 10
        + buildings.deuteriumSynthesizer * buildings.deuteriumSynthesizer * 3,
      profile.deuteriumMultiplierBps,
    ),
  };
}

export function energyBalance(buildings: Record<BuildingKey, number>): EnergyBalance {
  const required = (
    buildings.metalMine * 10
    + buildings.crystalMine * 12
    + buildings.deuteriumSynthesizer * 20
  );
  const produced = buildings.solarPlant * 30;

  return {
    produced,
    required,
    scaleBps: required === 0 || produced >= required
      ? BPS
      : Math.floor((produced * BPS) / required),
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

export function buildingEffectMetrics(
  buildings: Record<BuildingKey, number>,
  key: BuildingKey,
  profile: PlanetProductionProfile = PLANET,
): BuildingEffectMetrics {
  const nextBuildings = {
    ...buildings,
    [key]: buildings[key] + 1,
  };

  if (key === "metalMine" || key === "crystalMine" || key === "deuteriumSynthesizer") {
    const current = productionCapacityPerHour(buildings, profile);
    const next = productionCapacityPerHour(nextBuildings, profile);
    const resource = productionResourceForBuilding(key);

    return {
      kind: "production",
      resource,
      currentPerHour: current[resource],
      nextPerHour: next[resource],
      deltaPerHour: next[resource] - current[resource],
    };
  }

  if (key === "solarPlant") {
    const current = energyBalance(buildings);
    const next = energyBalance(nextBuildings);

    return {
      kind: "energy",
      currentProduced: current.produced,
      nextProduced: next.produced,
      deltaProduced: next.produced - current.produced,
      required: current.required,
    };
  }

  if (key === "metalStorage" || key === "crystalStorage" || key === "deuteriumTank") {
    const current = storageCaps(buildings);
    const next = storageCaps(nextBuildings);
    const resource = storageResourceForBuilding(key);

    return {
      kind: "storage",
      resource,
      currentCapacity: current[resource],
      nextCapacity: next[resource],
      deltaCapacity: next[resource] - current[resource],
    };
  }

  if (key === "roboticsFactory") {
    return {
      kind: "constructionSpeed",
      currentFactor: buildings.roboticsFactory + 1,
      nextFactor: nextBuildings.roboticsFactory + 1,
    };
  }

  if (key === "shipyard") {
    return {
      kind: "shipyard",
      currentFactor: Math.max(1, buildings.shipyard + 1),
      nextFactor: nextBuildings.shipyard + 1,
      unlocked: buildings.shipyard > 0,
      nextUnlocked: nextBuildings.shipyard > 0,
    };
  }

  return {
    kind: "researchSpeed",
    currentFactor: buildings.researchLab + 1,
    nextFactor: nextBuildings.researchLab + 1,
  };
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

export function researchRequirementsFor(key: ResearchKey): ResearchRequirement[] {
  const entry = researchCatalog.find((item) => item.key === key);
  if (!entry) {
    return [...BASE_RESEARCH_REQUIREMENTS];
  }

  return [...BASE_RESEARCH_REQUIREMENTS, ...(entry.requirements ?? [])];
}

export function unmetResearchRequirement(
  state: Pick<PlayableState, "buildings" | "research">,
  key: ResearchKey,
): ResearchRequirement | undefined {
  return researchRequirementsFor(key).find((requirement) => {
    if (requirement.type === "building") {
      return state.buildings[requirement.key] < requirement.level;
    }

    return state.research[requirement.key] < requirement.level;
  });
}

export function researchDurationEstimate(
  buildings: Record<BuildingKey, number>,
  cost: Resources,
): number {
  return researchDurationSeconds(buildings.researchLab, cost);
}

export function buildingDurationEstimate(
  buildings: Record<BuildingKey, number>,
  cost: Resources,
): number {
  return buildingDurationSeconds(buildings.roboticsFactory, cost);
}

export function canAfford(resources: Resources, cost: Resources): boolean {
  return resources.metal >= cost.metal
    && resources.crystal >= cost.crystal
    && resources.deuterium >= cost.deuterium;
}

export function hasCollectableResources(
  rates: Resources,
  lastSettledAtSeconds: number,
  now = Date.now(),
): boolean {
  const elapsedSeconds = Math.max(0, Math.floor(now / 1_000) - lastSettledAtSeconds);
  return resourceEntries(rates).some(([, ratePerHour]) => (
    Math.floor((Math.max(0, ratePerHour) * elapsedSeconds) / 3_600) > 0
  ));
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

function productionResourceForBuilding(key: BuildingKey): keyof Resources {
  if (key === "metalMine") {
    return "metal";
  }

  if (key === "crystalMine") {
    return "crystal";
  }

  return "deuterium";
}

function storageResourceForBuilding(key: BuildingKey): keyof Resources {
  if (key === "metalStorage") {
    return "metal";
  }

  if (key === "crystalStorage") {
    return "crystal";
  }

  return "deuterium";
}

function buildingDurationSeconds(roboticsLevel: number, cost: Resources): number {
  const raw = Math.floor((cost.metal + cost.crystal) / (100 * (roboticsLevel + 1)));
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function researchDurationSeconds(researchLabLevel: number, cost: Resources): number {
  const raw = Math.floor((cost.metal + cost.crystal + cost.deuterium) / (120 * (researchLabLevel + 1)));
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function scaleByBps(value: number, multiplierBps: number): number {
  return Math.floor((value * multiplierBps) / BPS);
}

function resourceEntries(resources: Resources): Array<[keyof Resources, number]> {
  return [
    ["metal", resources.metal],
    ["crystal", resources.crystal],
    ["deuterium", resources.deuterium],
  ];
}

function multiply(resources: Resources, quantity: number): Resources {
  return {
    metal: resources.metal * quantity,
    crystal: resources.crystal * quantity,
    deuterium: resources.deuterium * quantity,
  };
}
