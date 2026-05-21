import { defenseAssetByKey, researchAssetByKey, shipAssetByKey } from "./gameAssets";

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
  | "deuteriumTank"
  | "interdimensionalRiftStabilizer";

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
  interdimensionalRiftStabilizer: 15,
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

export type BuildingRequirement = {
  type: "building";
  key: BuildingKey;
  level: number;
} | {
  type: "research";
  key: ResearchKey;
  level: number;
};

export type UnlockRequirement = {
  label: string;
  kind: "building" | "technology";
  key?: BuildingKey | ResearchKey;
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
      relativeImprovementPercent: number;
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
      unlocked: boolean;
      nextUnlocked: boolean;
    }
  | {
      kind: "riftBridge";
      unlocked: boolean;
      nextUnlocked: boolean;
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
    baseCost: { metal: 400, crystal: 120, deuterium: 200 },
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
  {
    key: "interdimensionalRiftStabilizer",
    label: "Interdimensional Rift Stabilizer",
    baseCost: { metal: 8_000, crystal: 8_000, deuterium: 4_000 },
    asset: "/assets/game/style-pass/generated/buildings/interdimensional-rift-stabilizer-mid.webp",
  },
];

export const shipCatalog: Array<{
  key: ShipKey;
  id: number;
  label: string;
  group: "civil" | "combat" | "special";
  baseCost: Resources;
  requirements: UnlockRequirement[];
  asset: string;
}> = [
  {
    key: "smallCargo",
    id: 0,
    label: "Small Cargo",
    group: "civil",
    baseCost: { metal: 2_000, crystal: 2_000, deuterium: 0 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 2 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 2 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 4 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 6 },
      { kind: "technology", key: "shielding", label: "Shielding", level: 2 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 4 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 3 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 4 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 3 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 2 },
      { kind: "technology", key: "armor", label: "Armor", level: 2 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 5 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 4 },
      { kind: "technology", key: "ion", label: "Ion", level: 2 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 7 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 3 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 3 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 8 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 6 },
      { kind: "technology", key: "plasma", label: "Plasma", level: 5 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 9 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 6 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 5 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 12 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 7 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 6 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 8 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 5 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 5 },
      { kind: "technology", key: "laser", label: "Laser", level: 12 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 10 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 7 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 6 },
      { kind: "technology", key: "shielding", label: "Shielding", level: 6 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 5 },
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
  requirements: UnlockRequirement[];
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
    asset: researchAssetByKey.energy,
  },
  {
    key: "laser",
    id: 1,
    label: "Laser Technology",
    lane: "Basic",
    baseCost: { metal: 200, crystal: 100, deuterium: 0 },
    requirements: [{ type: "research", key: "energy", level: 1 }],
    asset: researchAssetByKey.laser,
  },
  {
    key: "ion",
    id: 2,
    label: "Ion Technology",
    lane: "Basic",
    baseCost: { metal: 1_000, crystal: 300, deuterium: 100 },
    requirements: [{ type: "research", key: "laser", level: 2 }],
    asset: researchAssetByKey.ion,
  },
  {
    key: "hyperspace",
    id: 9,
    label: "Hyperspace Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 4_000, deuterium: 2_000 },
    requirements: [{ type: "research", key: "energy", level: 5 }],
    asset: researchAssetByKey.hyperspace,
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
    asset: researchAssetByKey.plasma,
  },
  {
    key: "combustionDrive",
    id: 3,
    label: "Combustion Drive",
    lane: "Drive",
    baseCost: { metal: 400, crystal: 0, deuterium: 600 },
    asset: researchAssetByKey.combustionDrive,
  },
  {
    key: "impulseDrive",
    id: 10,
    label: "Impulse Drive",
    lane: "Drive",
    baseCost: { metal: 2_000, crystal: 4_000, deuterium: 600 },
    requirements: [{ type: "research", key: "energy", level: 1 }],
    asset: researchAssetByKey.impulseDrive,
  },
  {
    key: "hyperspaceDrive",
    id: 11,
    label: "Hyperspace Drive",
    lane: "Drive",
    baseCost: { metal: 10_000, crystal: 20_000, deuterium: 6_000 },
    requirements: [{ type: "research", key: "hyperspace", level: 3 }],
    asset: researchAssetByKey.hyperspaceDrive,
  },
  {
    key: "espionage",
    id: 4,
    label: "Espionage Technology",
    lane: "Advanced",
    baseCost: { metal: 200, crystal: 1_000, deuterium: 200 },
    asset: researchAssetByKey.espionage,
  },
  {
    key: "computer",
    id: 5,
    label: "Computer Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 400, deuterium: 600 },
    asset: researchAssetByKey.computer,
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
    asset: researchAssetByKey.astrophysics,
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
    asset: researchAssetByKey.intergalacticResearchNetwork,
  },
  {
    key: "graviton",
    id: 15,
    label: "Graviton Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 0, deuterium: 0 },
    requirements: [{ type: "research", key: "energy", level: 12 }],
    asset: researchAssetByKey.graviton,
  },
  {
    key: "weapons",
    id: 6,
    label: "Weapons Technology",
    lane: "Combat",
    baseCost: { metal: 800, crystal: 200, deuterium: 0 },
    asset: researchAssetByKey.weapons,
  },
  {
    key: "shielding",
    id: 7,
    label: "Shielding Technology",
    lane: "Combat",
    baseCost: { metal: 200, crystal: 600, deuterium: 0 },
    requirements: [{ type: "research", key: "energy", level: 1 }],
    asset: researchAssetByKey.shielding,
  },
  {
    key: "armor",
    id: 8,
    label: "Armor Technology",
    lane: "Combat",
    baseCost: { metal: 1_000, crystal: 0, deuterium: 0 },
    asset: researchAssetByKey.armor,
  },
];

const BASE_RESEARCH_REQUIREMENTS: ResearchRequirement[] = [
  { type: "building", key: "researchLab", level: 1 },
];

const BUILDING_REQUIREMENTS: Partial<Record<BuildingKey, BuildingRequirement[]>> = {
  researchLab: [{ type: "building", key: "roboticsFactory", level: 1 }],
  shipyard: [{ type: "building", key: "roboticsFactory", level: 2 }],
  interdimensionalRiftStabilizer: [
    { type: "building", key: "roboticsFactory", level: 2 },
    { type: "building", key: "researchLab", level: 1 },
    { type: "research", key: "energy", level: 2 },
  ],
};

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
    resources: { metal: 500, crystal: 500, deuterium: 0 },
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
      interdimensionalRiftStabilizer: 0,
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
    metal: scaledLevelValue(30, buildings.metalMine),
    crystal: scaledLevelValue(20, buildings.crystalMine),
    deuterium: scaleByBps(scaledLevelValue(10, buildings.deuteriumSynthesizer), profile.deuteriumMultiplierBps),
  };
}

export function energyBalance(buildings: Record<BuildingKey, number>): EnergyBalance {
  const required = (
    scaledLevelValue(10, buildings.metalMine)
    + scaledLevelValue(10, buildings.crystalMine)
    + scaledLevelValue(20, buildings.deuteriumSynthesizer)
  );
  const produced = scaledLevelValue(20, buildings.solarPlant);

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
    metal: storageCap(buildings.metalStorage),
    crystal: storageCap(buildings.crystalStorage),
    deuterium: storageCap(buildings.deuteriumTank),
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

  return scaleBuildingCost(entry.baseCost, key, buildings[key]);
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
    const currentFactor = buildings.roboticsFactory + 1;
    const nextFactor = nextBuildings.roboticsFactory + 1;

    return {
      kind: "constructionSpeed",
      currentFactor,
      nextFactor,
      relativeImprovementPercent: Math.round(((nextFactor - currentFactor) / currentFactor) * 100),
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

  if (key === "interdimensionalRiftStabilizer") {
    return {
      kind: "riftBridge",
      unlocked: buildings.interdimensionalRiftStabilizer > 0,
      nextUnlocked: nextBuildings.interdimensionalRiftStabilizer > 0,
    };
  }

  return {
    kind: "researchSpeed",
    currentFactor: buildings.researchLab + 1,
    nextFactor: nextBuildings.researchLab + 1,
    unlocked: buildings.researchLab > 0,
    nextUnlocked: nextBuildings.researchLab > 0,
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

  return uniqueRequirements([...BASE_RESEARCH_REQUIREMENTS, ...(entry.requirements ?? [])]);
}

export function buildingRequirementsFor(key: BuildingKey): BuildingRequirement[] {
  return uniqueRequirements(BUILDING_REQUIREMENTS[key] ?? []);
}

export function unmetBuildingRequirement(
  state: Pick<PlayableState, "buildings" | "research">,
  key: BuildingKey,
): BuildingRequirement | undefined {
  return buildingRequirementsFor(key).find((requirement) => {
    if (requirement.type === "building") {
      return state.buildings[requirement.key] < requirement.level;
    }

    return state.research[requirement.key] < requirement.level;
  });
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

export function missingUnlockRequirements(
  requirements: UnlockRequirement[],
  levels: {
    buildings?: Partial<Record<BuildingKey, number>> | undefined;
    research?: Partial<Record<ResearchKey, number>> | undefined;
  },
): string[] {
  const missing = uniqueUnlockRequirements(requirements).flatMap((requirement) => {
    const actual = requirement.kind === "building"
      ? levels.buildings?.[requirement.key as BuildingKey] ?? 0
      : levels.research?.[requirement.key as ResearchKey] ?? 0;

    return actual >= requirement.level
      ? []
      : [`Requires ${requirement.label} ${requirement.level}`];
  });

  return uniqueRequirementMessages(missing);
}

export function uniqueRequirementMessages(messages: readonly string[]): string[] {
  return uniqueBy(messages, (message) => message);
}

function uniqueRequirements<T extends BuildingRequirement | ResearchRequirement>(
  requirements: readonly T[],
): T[] {
  return uniqueBy(requirements, (requirement) => (
    `${requirement.type}:${requirement.key}:${requirement.level}`
  ));
}

function uniqueUnlockRequirements(requirements: readonly UnlockRequirement[]): UnlockRequirement[] {
  return uniqueBy(requirements, (requirement) => (
    `${requirement.kind}:${requirement.key ?? requirement.label}:${requirement.label}:${requirement.level}`
  ));
}

function uniqueBy<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
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
  return buildingDurationSeconds(buildings.roboticsFactory, 0, cost);
}

export function shipDurationEstimate(
  shipyardLevel: number,
  naniteLevel: number,
  cost: Resources,
  quantity = 1,
): number {
  return shipDurationSeconds(shipyardLevel, naniteLevel, cost, quantity);
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
  return resourceEntries(collectibleResourceDeltas(rates, lastSettledAtSeconds, now)).some(([, value]) => value > 0);
}

export function collectibleResourceDeltas(
  rates: Resources,
  lastSettledAtSeconds: number,
  now = Date.now(),
  currentResources?: Resources | undefined,
  caps?: Resources | undefined,
): Resources {
  const elapsedSeconds = Math.max(0, Math.floor(now / 1_000) - lastSettledAtSeconds);

  return resourceEntries(rates).reduce<Resources>((deltas, [resource, ratePerHour]) => {
    const produced = Math.floor((Math.max(0, ratePerHour) * elapsedSeconds) / 3_600);
    const remainingCapacity = currentResources && caps
      ? Math.max(0, caps[resource] - currentResources[resource])
      : undefined;

    deltas[resource] = remainingCapacity === undefined ? produced : Math.min(produced, remainingCapacity);
    return deltas;
  }, { metal: 0, crystal: 0, deuterium: 0 });
}

export function progress(queue: QueueItem | undefined, now = Date.now()): number {
  if (!queue) {
    return 0;
  }

  const total = queue.readyAt - queue.startedAt;
  const elapsed = now - queue.startedAt;
  if (!Number.isFinite(total) || total <= 0) {
    return now >= queue.readyAt ? 1 : 0;
  }

  return Math.min(1, Math.max(0, elapsed / total));
}

export function planetSummary() {
  return PLANET;
}

function scaleByLevel(cost: Resources, currentLevel: number): Resources {
  return {
    metal: scaleByFactor(cost.metal, currentLevel, 2, 1),
    crystal: scaleByFactor(cost.crystal, currentLevel, 2, 1),
    deuterium: scaleByFactor(cost.deuterium, currentLevel, 2, 1),
  };
}

function scaleBuildingCost(cost: Resources, key: BuildingKey, currentLevel: number): Resources {
  const [numerator, denominator] = buildingCostFactor(key);

  return {
    metal: scaleByFactor(cost.metal, currentLevel, numerator, denominator),
    crystal: scaleByFactor(cost.crystal, currentLevel, numerator, denominator),
    deuterium: scaleByFactor(cost.deuterium, currentLevel, numerator, denominator),
  };
}

function buildingCostFactor(key: BuildingKey): [number, number] {
  if (
    key === "metalMine"
    || key === "deuteriumSynthesizer"
    || key === "solarPlant"
  ) {
    return [15, 10];
  }

  if (key === "crystalMine") {
    return [16, 10];
  }

  return [2, 1];
}

function scaledLevelValue(base: number, level: number): number {
  if (level === 0) return 0;
  return Math.floor((base * level * (11 ** level)) / (10 ** level));
}

function scaleByFactor(value: number, exponent: number, numerator: number, denominator: number): number {
  return Math.floor((value * (numerator ** exponent)) / (denominator ** exponent));
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

const STORAGE_CAPS = [
  10_000,
  20_000,
  40_000,
  75_000,
  140_000,
  255_000,
  470_000,
  865_000,
  1_590_000,
  2_920_000,
  5_355_000,
  9_820_000,
  18_005_000,
  33_005_000,
  60_510_000,
  110_925_000,
  203_350_000,
  372_785_000,
  683_385_000,
  1_252_785_000,
  2_296_600_000,
  4_210_115_000,
  7_717_970_000,
  14_148_545_000,
  25_937_050_000,
  47_547_690_000,
  87_164_210_000,
  159_789_040_000,
  292_924_545_000,
  536_987_950_000,
  984_403_885_000,
];

function storageCap(level: number): number {
  return STORAGE_CAPS[level] ?? STORAGE_CAPS[STORAGE_CAPS.length - 1]!;
}

function buildingDurationSeconds(roboticsLevel: number, naniteLevel: number, cost: Resources): number {
  const roboticsDivisor = roboticsLevel + 1;
  const naniteDivisor = 2 ** naniteLevel;
  const raw = Math.floor(((cost.metal + cost.crystal) * 3_600) / (2_500 * roboticsDivisor * naniteDivisor));
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function researchDurationSeconds(researchLabLevel: number, cost: Resources): number {
  const raw = Math.floor(((cost.metal + cost.crystal) * 3_600) / (1_000 * (researchLabLevel + 1)));
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function shipDurationSeconds(shipyardLevel: number, naniteLevel: number, cost: Resources, quantity: number): number {
  const denominator = 2500 * (shipyardLevel + 1) * (2 ** naniteLevel);
  const raw = Math.ceil(((cost.metal + cost.crystal) * Math.max(1, Math.floor(quantity)) * 3_600) / denominator);
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
