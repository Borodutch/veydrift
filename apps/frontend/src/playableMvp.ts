import { solarSatelliteEnergy as universeSolarSatelliteEnergy } from "@veydrift/universe";
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
  | "fusionReactor"
  | "naniteFactory"
  | "terraformer"
  | "allianceDepot"
  | "missileSilo"
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
  fusionReactor: 10,
  naniteFactory: 11,
  terraformer: 12,
  allianceDepot: 13,
  missileSilo: 14,
  interdimensionalRiftStabilizer: 15,
};

export function isBinaryBuilding(key: BuildingKey): boolean {
  return key === "interdimensionalRiftStabilizer";
}

export type ShipKey =
  | "smallCargo"
  | "lightFighter"
  | "recycler"
  | "colonyShip"
  | "largeCargo"
  | "heavyFighter"
  | "cruiser"
  | "battleship"
  | "bomber"
  | "solarSatellite"
  | "destroyer"
  | "deathstar"
  | "battlecruiser"
  | "reaper"
  | "pathfinder"
  | "crawler";
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
    }
  | {
      type: "energy";
      produced: number;
    };

export type ResearchEffectRow = {
  current: string;
  delta?: string;
  next: string;
  target: string;
};

export type BuildingRequirement =
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

export type UnlockBuildingKey = BuildingKey | "missileSilo";

export type UnlockRequirement = {
  label: string;
  kind: "building" | "technology";
  key?: UnlockBuildingKey | ResearchKey;
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

export type QueueTimeline = {
  readyAt: number;
  startedAt: number;
};

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
  deuteriumConsumed: number;
  produced: number;
  required: number;
  scaleBps: number;
  sources?: {
    solarPlant: number;
    fusionReactor: number;
    fusionReactorDeuteriumConsumed: number;
    solarSatellites: number;
    solarSatelliteCount: number;
    solarSatelliteEnergy: number;
  };
};

export type PlanetProductionProfile = {
  maxTemperature?: number;
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
      currentDeuteriumConsumed: number;
      currentProduced: number;
      deltaDeuteriumConsumed: number;
      nextProduced: number;
      deltaProduced: number;
      nextDeuteriumConsumed: number;
      required: number;
      showsDeuteriumConsumption: boolean;
    }
  | {
      kind: "storage";
      resource: keyof Resources;
      currentCapacity: number;
      nextCapacity: number;
      deltaCapacity: number;
    }
  | {
      kind: "missileSilo";
      currentSlots: number;
      nextSlots: number;
      deltaSlots: number;
    }
  | {
      kind: "allianceDepot";
      currentSupport: number;
      nextSupport: number;
      deltaSupport: number;
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
      relativeImprovementPercent: number;
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
      kind: "terraformer";
      currentFieldsAdded: number;
      nextFieldsAdded: number;
      deltaFields: number;
    }
  | {
      kind: "facility";
      currentLevel: number;
      nextLevel: number;
      label: string;
      binary?: boolean;
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
    key: "fusionReactor",
    label: "Fusion Reactor",
    baseCost: { metal: 900, crystal: 360, deuterium: 180 },
    asset: "/assets/game/style-pass/generated/buildings/fusion-reactor-mid.webp",
  },
  {
    key: "naniteFactory",
    label: "Nanite Factory",
    baseCost: { metal: 1_000_000, crystal: 500_000, deuterium: 100_000 },
    asset: "/assets/game/style-pass/generated/buildings/nanite-factory-mid.webp",
  },
  {
    key: "terraformer",
    label: "Terraformer",
    baseCost: { metal: 0, crystal: 50_000, deuterium: 100_000 },
    asset: "/assets/game/style-pass/generated/buildings/terraformer-mid.webp",
  },
  {
    key: "allianceDepot",
    label: "Alliance Depot",
    baseCost: { metal: 20_000, crystal: 40_000, deuterium: 0 },
    asset: "/assets/game/style-pass/generated/buildings/alliance-depot-mid.webp",
  },
  {
    key: "missileSilo",
    label: "Missile Silo",
    baseCost: { metal: 20_000, crystal: 20_000, deuterium: 1_000 },
    asset: "/assets/game/style-pass/generated/buildings/missile-silo-mid.webp",
  },
  {
    key: "interdimensionalRiftStabilizer",
    label: "Rift Stabilizer",
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
  description: string;
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
    description: "A nimble freighter for early raids and supply runs. Its hold is modest, but it is cheap enough to mass-produce while a young colony is still finding its footing.",
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
    description: "A cheap interceptor built around speed and numbers. Light Fighters are fragile alone, yet large wings can screen heavier ships and add efficient firepower.",
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
    description: "A recovery vessel with reinforced storage bays for debris-field salvage. Recyclers are slow and lightly armed, so they work best behind secured battle plans.",
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
    description: "A self-contained settlement ark carrying the equipment needed to found a new planet. It is expensive, slow, and strategically decisive.",
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
    description: "The standard bulk hauler for mature economies. Large Cargos trade speed for capacity and move resources efficiently between planets or after attacks.",
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
    description: "A tougher fighter platform with heavier guns and stronger plating. Heavy Fighters can punch through light screens but still need support against capital ships.",
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
    description: "A fast strike ship that excels at hunting light fleets. Cruisers combine high speed with credible armor, making them a flexible offensive workhorse.",
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
    description: "A mainline capital ship with heavy batteries and durable armor. Battleships anchor mid-game fleets before specialized hulls take over.",
    asset: shipAssetByKey.battleship,
  },
  {
    key: "bomber",
    id: 8,
    label: "Bomber",
    group: "combat",
    baseCost: { metal: 50_000, crystal: 25_000, deuterium: 15_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 8 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 6 },
      { kind: "technology", key: "plasma", label: "Plasma", level: 5 },
    ],
    description: "A siege craft built to crack entrenched defenses. Bombers are costly to launch, but their payloads make them valuable when static defenses block progress.",
    asset: shipAssetByKey.bomber,
  },
  {
    key: "solarSatellite",
    id: 9,
    label: "Solar Satellite",
    group: "special",
    baseCost: { metal: 0, crystal: 2_000, deuterium: 500 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
    ],
    description: "An orbital energy platform with almost no combat role. Solar Satellites are efficient power sources, but their fragile frames remain exposed during attacks.",
    asset: shipAssetByKey.solarSatellite,
  },
  {
    key: "destroyer",
    id: 10,
    label: "Destroyer",
    group: "combat",
    baseCost: { metal: 60_000, crystal: 50_000, deuterium: 15_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 9 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 6 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 5 },
    ],
    description: "A heavy assault ship designed to remove large threats. Destroyers are slow and expensive, but their hull and firepower dominate prolonged fleet battles.",
    asset: shipAssetByKey.destroyer,
  },
  {
    key: "deathstar",
    id: 11,
    label: "Dreadstar",
    group: "special",
    baseCost: { metal: 5_000_000, crystal: 4_000_000, deuterium: 1_000_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 12 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 7 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 6 },
      { kind: "technology", key: "graviton", label: "Graviton", level: 1 },
    ],
    description: "A colossal strategic platform with extreme armor, shielding, and cargo capacity. The Dreadstar is slow, rare, and built for decisive projection of force.",
    asset: shipAssetByKey.deathstar,
  },
  {
    key: "battlecruiser",
    id: 12,
    label: "Battlecruiser",
    group: "combat",
    baseCost: { metal: 30_000, crystal: 40_000, deuterium: 15_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 8 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 5 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 5 },
      { kind: "technology", key: "laser", label: "Laser", level: 12 },
    ],
    description: "A precision capital hunter with strong shields and efficient hyperspace engines. Battlecruisers are leaner than Battleships and built for fast fleet combat.",
    asset: shipAssetByKey.battlecruiser,
  },
  {
    key: "reaper",
    id: 13,
    label: "Reaper",
    group: "combat",
    baseCost: { metal: 85_000, crystal: 55_000, deuterium: 20_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 10 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 7 },
      { kind: "technology", key: "hyperspace", label: "Hyperspace", level: 6 },
      { kind: "technology", key: "shielding", label: "Shielding", level: 6 },
      { kind: "technology", key: "energy", label: "Energy", level: 5 },
    ],
    description: "A late-era raider with brutal weapons and a generous hold. Reapers are expensive, but they bring the range and punch needed for high-value attacks.",
    asset: shipAssetByKey.reaper,
  },
  {
    // VEY-KANEO-493: ship enum slot 14 (key `pathfinder`) is retained for on-chain
    // index alignment but is expedition-only and unimplemented, so it is hidden from the
    // shipyard and must never surface user-visible copy. The display label/description are
    // intentionally neutral placeholders (not the external-game "Pathfinder" name); this
    // catalog entry is never rendered because the ship cannot be built, owned, or queued.
    key: "pathfinder",
    id: 14,
    label: "Restricted Vessel",
    group: "special",
    baseCost: { metal: 8_000, crystal: 15_000, deuterium: 8_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 5 },
      { kind: "technology", key: "hyperspaceDrive", label: "Hyperspace Drive", level: 2 },
      { kind: "technology", key: "shielding", label: "Shielding", level: 4 },
    ],
    description: "This vessel is not available in the current build.",
    asset: shipAssetByKey.pathfinder,
  },
  {
    key: "crawler",
    id: 15,
    label: "Crawler",
    group: "special",
    baseCost: { metal: 2_000, crystal: 2_000, deuterium: 1_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 5 },
      { kind: "technology", key: "combustionDrive", label: "Combustion Drive", level: 4 },
      { kind: "technology", key: "armor", label: "Armor", level: 4 },
      { kind: "technology", key: "laser", label: "Laser", level: 4 },
    ],
    description: "A stationary mining-support unit rather than a fleet ship: crawlers do not fly, haul cargo, or fight. They boost this planet's metal, crystal, and deuterium mine output.",
    asset: shipAssetByKey.crawler,
  },
];

// Ships that exist in the on-chain `Ship` enum and stay fully modelled here (combat
// stats, queue labels, research effects) but must not be offered for production in the
// frontend shipyard. The `pathfinder` slot (enum index 14) is expedition-only, and
// expeditions are not implemented, so building one is a dead-end spend. The contract enum
// is intentionally left intact so on-chain ship indices do not shift; its user-visible
// copy is scrubbed (see the neutral label/description above — VEY-KANEO-493).
export const shipyardHiddenShipKeys: ReadonlySet<ShipKey> = new Set<ShipKey>(["pathfinder"]);

export function isShipyardHidden(key: ShipKey): boolean {
  return shipyardHiddenShipKeys.has(key);
}

// Buildable subset of `shipCatalog` for the shipyard UI. `shipCatalog` remains the
// complete source of truth for stats, queue label resolution, and research effects.
export const shipyardCatalog = shipCatalog.filter((ship) => !isShipyardHidden(ship.key));

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
    baseCost: { metal: 2_000, crystal: 0, deuterium: 0 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 2 },
      { kind: "technology", key: "energy", label: "Energy", level: 1 },
      { kind: "technology", key: "laser", label: "Laser", level: 3 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 4 },
      { kind: "technology", key: "energy", label: "Energy", level: 3 },
      { kind: "technology", key: "laser", label: "Laser", level: 6 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 6 },
      { kind: "technology", key: "energy", label: "Energy", level: 6 },
      { kind: "technology", key: "weapons", label: "Weapons", level: 3 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 4 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 8 },
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
      { kind: "building", key: "shipyard", label: "Shipyard", level: 6 },
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
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "building", key: "missileSilo", label: "Missile Silo", level: 2 },
    ],
    asset: defenseAssetByKey.antiBallisticMissile,
  },
  {
    key: "interplanetaryMissile",
    id: 9,
    label: "Interplanetary Missile",
    group: "missile",
    baseCost: { metal: 12_500, crystal: 2_500, deuterium: 10_000 },
    requirements: [
      { kind: "building", key: "shipyard", label: "Shipyard", level: 1 },
      { kind: "building", key: "missileSilo", label: "Missile Silo", level: 4 },
      { kind: "technology", key: "impulseDrive", label: "Impulse Drive", level: 1 },
    ],
    asset: defenseAssetByKey.interplanetaryMissile,
  },
];

export type CombatStatRow = {
  label: string;
  value: number | string;
  hint?: string | undefined;
};

export type CombatStatBlock = {
  rows: CombatStatRow[];
  notes: string[];
};

export type ShipSpecRow = {
  label: string;
  value: string;
};

const shipCargoCapacityByKey: Record<ShipKey, number> = {
  smallCargo: 5_000,
  lightFighter: 50,
  recycler: 20_000,
  colonyShip: 7_500,
  largeCargo: 25_000,
  heavyFighter: 100,
  cruiser: 800,
  battleship: 1_500,
  bomber: 500,
  solarSatellite: 0,
  destroyer: 2_000,
  deathstar: 1_000_000,
  battlecruiser: 750,
  reaper: 7_000,
  pathfinder: 12_000,
  crawler: 0,
};

const shipBaseSpeedByKey: Record<ShipKey, number> = {
  smallCargo: 5_000,
  lightFighter: 12_500,
  recycler: 2_000,
  colonyShip: 2_500,
  largeCargo: 7_500,
  heavyFighter: 10_000,
  cruiser: 15_000,
  battleship: 10_000,
  bomber: 4_000,
  solarSatellite: 0,
  destroyer: 5_000,
  deathstar: 100,
  battlecruiser: 10_000,
  reaper: 7_000,
  pathfinder: 12_000,
  crawler: 0,
};

const shipFuelConsumptionByKey: Record<ShipKey, number> = {
  smallCargo: 10,
  lightFighter: 20,
  recycler: 300,
  colonyShip: 1_000,
  largeCargo: 50,
  heavyFighter: 75,
  cruiser: 300,
  battleship: 500,
  bomber: 1_000,
  solarSatellite: 0,
  destroyer: 1_000,
  deathstar: 1,
  battlecruiser: 250,
  reaper: 1_000,
  pathfinder: 300,
  crawler: 0,
};

const shipBattleStatsByKey: Record<ShipKey, { attack: number; shield: number; hull: number }> = {
  smallCargo: { attack: 5, shield: 10, hull: 400 },
  lightFighter: { attack: 50, shield: 10, hull: 400 },
  recycler: { attack: 1, shield: 10, hull: 1_600 },
  colonyShip: { attack: 50, shield: 100, hull: 3_000 },
  largeCargo: { attack: 5, shield: 25, hull: 1_200 },
  heavyFighter: { attack: 150, shield: 25, hull: 1_000 },
  cruiser: { attack: 400, shield: 50, hull: 2_700 },
  battleship: { attack: 1_000, shield: 200, hull: 6_000 },
  bomber: { attack: 1_000, shield: 500, hull: 7_500 },
  solarSatellite: { attack: 1, shield: 1, hull: 200 },
  destroyer: { attack: 2_000, shield: 500, hull: 11_000 },
  deathstar: { attack: 200_000, shield: 50_000, hull: 900_000 },
  battlecruiser: { attack: 700, shield: 400, hull: 7_000 },
  reaper: { attack: 2_800, shield: 700, hull: 14_000 },
  pathfinder: { attack: 200, shield: 100, hull: 2_300 },
  crawler: { attack: 1, shield: 1, hull: 400 },
};

const defenseBattleStatsByKey: Partial<Record<DefenseKey, { attack: number; shield: number; hull: number }>> = {
  rocketLauncher: { attack: 80, shield: 20, hull: 200 },
  lightLaser: { attack: 100, shield: 25, hull: 200 },
  heavyLaser: { attack: 250, shield: 100, hull: 800 },
  smallShieldDome: { attack: 1, shield: 2_000, hull: 2_000 },
  gaussCannon: { attack: 1_100, shield: 200, hull: 3_500 },
  ionCannon: { attack: 150, shield: 500, hull: 800 },
  plasmaTurret: { attack: 3_000, shield: 300, hull: 10_000 },
  largeShieldDome: { attack: 1, shield: 10_000, hull: 10_000 },
};

const fleetMissionShipKeys = new Set<ShipKey>([
  "smallCargo",
  "lightFighter",
  "recycler",
  "colonyShip",
  "largeCargo",
  "heavyFighter",
  "cruiser",
  "battleship",
  "bomber",
  "destroyer",
  "deathstar",
  "battlecruiser",
  "reaper",
  "pathfinder",
]);

const combustionDriveShipKeys: ShipKey[] = ["smallCargo", "lightFighter", "recycler", "largeCargo"];
const impulseDriveShipKeys: ShipKey[] = ["smallCargo", "colonyShip", "heavyFighter", "cruiser", "bomber"];
const hyperspaceDriveShipKeys: ShipKey[] = [
  "battleship",
  "bomber",
  "destroyer",
  "deathstar",
  "battlecruiser",
  "reaper",
  "pathfinder",
];

function driveEffectRows(
  currentResearch: Record<ResearchKey, number>,
  nextResearch: Record<ResearchKey, number>,
  key: "combustionDrive" | "impulseDrive" | "hyperspaceDrive",
): ResearchEffectRow[] {
  const shipKeys = key === "combustionDrive"
    ? combustionDriveShipKeys
    : key === "impulseDrive"
      ? impulseDriveShipKeys
      : hyperspaceDriveShipKeys;

  return shipKeys.flatMap((shipKey) => {
    const ship = shipCatalog.find((item) => item.key === shipKey);
    if (!ship) return [];
    // VEY-KANEO-493: never surface shipyard-hidden ships (e.g. the expedition-only
    // `pathfinder` slot) in research effect copy — they keep their drive math for index
    // fidelity but must not appear in any player-readable list.
    if (isShipyardHidden(shipKey)) return [];

    const currentSpeed = shipSpeed(shipKey, currentResearch);
    const nextSpeed = shipSpeed(shipKey, nextResearch);
    const rows = currentSpeed !== nextSpeed
      ? [numberEffectRow(`${ship.label} speed`, currentSpeed, nextSpeed)]
      : [];

    if (shipKey === "smallCargo" && key === "impulseDrive") {
      const currentFuel = shipFuelConsumption(shipKey, currentResearch);
      const nextFuel = shipFuelConsumption(shipKey, nextResearch);
      if (currentFuel !== nextFuel) {
        rows.push(numberEffectRow("Small Cargo fuel use", currentFuel, nextFuel));
      }
    }

    return rows;
  });
}

function shipFuelConsumption(ship: ShipKey, research: Record<ResearchKey, number>): number {
  if (ship === "smallCargo" && research.impulseDrive >= 5) return 20;
  return shipFuelConsumptionByKey[ship];
}

function shipSpeed(ship: ShipKey, research: Record<ResearchKey, number>): number {
  if (ship === "smallCargo" && research.impulseDrive >= 5) {
    return driveSpeed(10_000, research.impulseDrive, 20);
  }

  if (ship === "bomber" && research.hyperspaceDrive >= 8) {
    return driveSpeed(5_000, research.hyperspaceDrive, 30);
  }

  if (combustionDriveShipKeys.includes(ship)) {
    return driveSpeed(shipBaseSpeedByKey[ship], research.combustionDrive, 10);
  }

  if (impulseDriveShipKeys.includes(ship)) {
    return driveSpeed(shipBaseSpeedByKey[ship], research.impulseDrive, 20);
  }

  if (hyperspaceDriveShipKeys.includes(ship)) {
    return driveSpeed(shipBaseSpeedByKey[ship], research.hyperspaceDrive, 30);
  }

  return shipBaseSpeedByKey[ship];
}

function driveSpeed(baseSpeed: number, driveLevel: number, percentPerLevel: number): number {
  return Math.floor((baseSpeed * (100 + driveLevel * percentPerLevel)) / 100);
}

function fleetSlotLimit(computerLevel: number): number {
  return 1 + computerLevel;
}

function planetLimit(astrophysicsLevel: number): number {
  return 1 + astrophysicsLevel;
}

function linkedResearchLabSlotSummary(networkLevel: number, researchNetworkLabLevels: readonly number[]) {
  const linkedCount = Math.max(0, Math.floor(networkLevel));
  const linkedLevels = [...researchNetworkLabLevels]
    .sort((left, right) => right - left)
    .slice(0, linkedCount);
  const linkedLevelTotal = linkedLevels.reduce((total, level) => total + level, 0);

  return {
    label: linkedLevels.length > 0
      ? `${linkedLevels.length} labs / +${formatPlainNumber(linkedLevelTotal)} levels`
      : "No linked labs",
    linkedCount: linkedLevels.length,
    linkedLevelTotal,
  };
}

function percentMultiplierRow(target: string, currentLevel: number, nextLevel: number): ResearchEffectRow {
  return {
    current: `+${formatPlainNumber(currentLevel * 10)}%`,
    delta: "+10%",
    next: `+${formatPlainNumber(nextLevel * 10)}%`,
    target,
  };
}

function numberEffectRow(target: string, current: number, next: number, suffix = ""): ResearchEffectRow {
  const delta = next !== current ? formatSignedPlain(next - current) : undefined;
  return {
    current: `${formatPlainNumber(current)}${suffix}`,
    ...(delta ? { delta } : {}),
    next: `${formatPlainNumber(next)}${suffix}`,
    target,
  };
}

function formatPlainNumber(value: number): string {
  return Math.floor(value).toLocaleString("en-US");
}

function formatSignedPlain(value: number): string {
  const rounded = Math.floor(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("en-US")}`;
}

export function shipSpecRows(ship: (typeof shipCatalog)[number]): ShipSpecRow[] {
  const stats = shipBattleStatsByKey[ship.key];

  return [
    { label: "Structure", value: formatSpecValue(stats.hull) },
    { label: "Shield", value: formatSpecValue(stats.shield) },
    { label: "Attack", value: formatSpecValue(stats.attack) },
    { label: "Cargo", value: formatSpecValue(shipCargoCapacityByKey[ship.key]) },
    { label: "Base speed", value: formatShipSpeed(shipBaseSpeedByKey[ship.key]) },
    { label: "Fuel use", value: formatShipFuel(shipFuelConsumptionByKey[ship.key]) },
  ];
}

export function shipCombatStats(ship: (typeof shipCatalog)[number]): CombatStatBlock {
  const stats = shipBattleStatsByKey[ship.key];
  const notes = [
    "Mission fuel uses per-ship fuel consumption, distance, and selected mission speed.",
    "Battle resolution uses six Veydrift rounds with unit-weighted target selection, shields, hull explosion checks, tech scaling, rapid-fire where cataloged, and post-battle defense repair.",
  ];

  if (!fleetMissionShipKeys.has(ship.key)) {
    notes.unshift("Cannot be assigned to fleet missions; it only contributes when present on a defending planet.");
  }

  return {
    rows: [
      {
        label: "Attack",
        value: stats.attack,
        hint: "Scaled by Weapons Technology.",
      },
      {
        label: "Shield",
        value: stats.shield,
        hint: "Scaled by Shielding Technology and refreshed each battle round.",
      },
      {
        label: "Hull",
        value: stats.hull,
        hint: "Scaled by Armor Technology for hull damage and explosion checks.",
      },
      {
        label: "Cargo",
        value: shipCargoCapacityByKey[ship.key],
        hint: "Contract cargo capacity for missions and loot.",
      },
    ],
    notes,
  };
}

function formatSpecValue(value: number): string {
  return value.toLocaleString("en-US");
}

function formatShipSpeed(value: number): string {
  return value > 0 ? formatSpecValue(value) : "Stationary";
}

function formatShipFuel(value: number): string {
  return value > 0 ? formatSpecValue(value) : "None";
}

export function defenseCombatStats(defense: (typeof defenseCatalog)[number]): CombatStatBlock {
  const battlefieldDefense = defense.id <= 7;
  const notes = battlefieldDefense
    ? ["Battle resolution uses six Veydrift rounds with unit-weighted target selection, shields, hull explosion checks, tech scaling, rapid-fire where cataloged, and post-battle defense repair."]
    : ["Missile attack and interception rules are separate from current fleet battle defense stats."];

  if (defense.key === "smallShieldDome" || defense.key === "largeShieldDome") {
    notes.unshift("Shield domes are limited to one of each type per planet.");
  }

  if (!battlefieldDefense) {
    return {
      rows: [
        {
          label: "Fleet battle",
          value: "Not counted",
          hint: "Missiles are silo ordnance and are not included in current fleet battle defense totals.",
        },
        {
          label: "Silo slots",
          value: defense.key === "interplanetaryMissile" ? 2 : 1,
          hint: "Missile silo capacity cost from the contract catalog.",
        },
      ],
      notes,
    };
  }

  const stats = defenseBattleStatsByKey[defense.key]!;

  return {
    rows: [
      {
        label: "Attack",
        value: stats.attack,
        hint: "Scaled by Weapons Technology.",
      },
      {
        label: "Shield",
        value: stats.shield,
        hint: "Scaled by Shielding Technology and refreshed each battle round.",
      },
      {
        label: "Hull",
        value: stats.hull,
        hint: "Scaled by Armor Technology for hull damage and explosion checks.",
      },
    ],
    notes,
  };
}

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
    requirements: [{ type: "building", key: "researchLab", level: 1 }],
    asset: researchAssetByKey.energy,
  },
  {
    key: "laser",
    id: 1,
    label: "Laser Technology",
    lane: "Basic",
    baseCost: { metal: 200, crystal: 100, deuterium: 0 },
    requirements: [
      { type: "building", key: "researchLab", level: 1 },
      { type: "research", key: "energy", level: 2 },
    ],
    asset: researchAssetByKey.laser,
  },
  {
    key: "ion",
    id: 2,
    label: "Ion Technology",
    lane: "Basic",
    baseCost: { metal: 1_000, crystal: 300, deuterium: 100 },
    requirements: [
      { type: "building", key: "researchLab", level: 4 },
      { type: "research", key: "energy", level: 4 },
      { type: "research", key: "laser", level: 5 },
    ],
    asset: researchAssetByKey.ion,
  },
  {
    key: "hyperspace",
    id: 8,
    label: "Hyperspace Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 4_000, deuterium: 2_000 },
    requirements: [
      { type: "building", key: "researchLab", level: 7 },
      { type: "research", key: "energy", level: 5 },
      { type: "research", key: "shielding", level: 5 },
    ],
    asset: researchAssetByKey.hyperspace,
  },
  {
    key: "plasma",
    id: 11,
    label: "Plasma Technology",
    lane: "Advanced",
    baseCost: { metal: 2_000, crystal: 4_000, deuterium: 1_000 },
    requirements: [
      { type: "building", key: "researchLab", level: 4 },
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
    requirements: [
      { type: "building", key: "researchLab", level: 1 },
      { type: "research", key: "energy", level: 1 },
    ],
    asset: researchAssetByKey.combustionDrive,
  },
  {
    key: "impulseDrive",
    id: 9,
    label: "Impulse Drive",
    lane: "Drive",
    baseCost: { metal: 2_000, crystal: 4_000, deuterium: 600 },
    requirements: [
      { type: "building", key: "researchLab", level: 2 },
      { type: "research", key: "energy", level: 1 },
    ],
    asset: researchAssetByKey.impulseDrive,
  },
  {
    key: "hyperspaceDrive",
    id: 10,
    label: "Hyperspace Drive",
    lane: "Drive",
    baseCost: { metal: 10_000, crystal: 20_000, deuterium: 6_000 },
    requirements: [
      { type: "building", key: "researchLab", level: 7 },
      { type: "research", key: "hyperspace", level: 3 },
    ],
    asset: researchAssetByKey.hyperspaceDrive,
  },
  {
    key: "computer",
    id: 4,
    label: "Computer Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 400, deuterium: 600 },
    requirements: [{ type: "building", key: "researchLab", level: 1 }],
    asset: researchAssetByKey.computer,
  },
  {
    key: "astrophysics",
    id: 12,
    label: "Astrophysics",
    lane: "Advanced",
    baseCost: { metal: 4_000, crystal: 8_000, deuterium: 4_000 },
    requirements: [
      { type: "building", key: "researchLab", level: 3 },
      { type: "research", key: "impulseDrive", level: 3 },
    ],
    asset: researchAssetByKey.astrophysics,
  },
  {
    key: "intergalacticResearchNetwork",
    id: 13,
    label: "Intergalactic Research Network",
    lane: "Advanced",
    baseCost: { metal: 240_000, crystal: 400_000, deuterium: 160_000 },
    requirements: [
      { type: "building", key: "researchLab", level: 10 },
      { type: "research", key: "computer", level: 8 },
      { type: "research", key: "hyperspace", level: 8 },
    ],
    asset: researchAssetByKey.intergalacticResearchNetwork,
  },
  {
    key: "graviton",
    id: 14,
    label: "Graviton Technology",
    lane: "Advanced",
    baseCost: { metal: 0, crystal: 0, deuterium: 0 },
    requirements: [
      { type: "building", key: "researchLab", level: 12 },
      { type: "energy", produced: 300_000 },
    ],
    asset: researchAssetByKey.graviton,
  },
  {
    key: "weapons",
    id: 5,
    label: "Weapons Technology",
    lane: "Combat",
    baseCost: { metal: 800, crystal: 200, deuterium: 0 },
    requirements: [{ type: "building", key: "researchLab", level: 4 }],
    asset: researchAssetByKey.weapons,
  },
  {
    key: "shielding",
    id: 6,
    label: "Shielding Technology",
    lane: "Combat",
    baseCost: { metal: 200, crystal: 600, deuterium: 0 },
    requirements: [
      { type: "building", key: "researchLab", level: 6 },
      { type: "research", key: "energy", level: 3 },
    ],
    asset: researchAssetByKey.shielding,
  },
  {
    key: "armor",
    id: 7,
    label: "Armor Technology",
    lane: "Combat",
    baseCost: { metal: 1_000, crystal: 0, deuterium: 0 },
    requirements: [{ type: "building", key: "researchLab", level: 2 }],
    asset: researchAssetByKey.armor,
  },
];

const BASE_RESEARCH_REQUIREMENTS: ResearchRequirement[] = [];

const BUILDING_REQUIREMENTS: Partial<Record<BuildingKey, BuildingRequirement[]>> = {
  researchLab: [{ type: "building", key: "roboticsFactory", level: 1 }],
  shipyard: [{ type: "building", key: "roboticsFactory", level: 2 }],
  fusionReactor: [
    { type: "building", key: "deuteriumSynthesizer", level: 5 },
    { type: "research", key: "energy", level: 3 },
  ],
  naniteFactory: [
    { type: "building", key: "roboticsFactory", level: 10 },
    { type: "research", key: "computer", level: 10 },
  ],
  terraformer: [
    { type: "building", key: "naniteFactory", level: 1 },
    { type: "research", key: "energy", level: 12 },
  ],
  missileSilo: [{ type: "building", key: "shipyard", level: 1 }],
  interdimensionalRiftStabilizer: [
    { type: "building", key: "roboticsFactory", level: 4 },
    { type: "building", key: "researchLab", level: 2 },
    { type: "research", key: "energy", level: 5 },
    { type: "research", key: "hyperspace", level: 1 },
  ],
};

export function researchEffectRows(
  state: Pick<PlayableState, "buildings" | "research" | "ships">,
  key: ResearchKey,
  options: {
    researchNetworkLabLevels?: readonly number[] | undefined;
  } = {},
): ResearchEffectRow[] {
  const currentLevel = state.research[key];
  const nextResearch = {
    ...state.research,
    [key]: currentLevel + 1,
  };

  if (key === "energy") {
    const current = energyBalance(state.buildings, state.research.energy, state.ships.solarSatellite).sources?.fusionReactor ?? 0;
    const next = energyBalance(state.buildings, nextResearch.energy, state.ships.solarSatellite).sources?.fusionReactor ?? 0;
    return [numberEffectRow("Fusion Reactor output", current, next, " produced")];
  }

  if (key === "combustionDrive" || key === "impulseDrive" || key === "hyperspaceDrive") {
    return driveEffectRows(state.research, nextResearch, key);
  }

  if (key === "computer") {
    return [numberEffectRow("Fleet mission slots", fleetSlotLimit(currentLevel), fleetSlotLimit(currentLevel + 1))];
  }

  if (key === "astrophysics") {
    return [numberEffectRow("Owned planet limit", planetLimit(currentLevel), planetLimit(currentLevel + 1))];
  }

  if (key === "intergalacticResearchNetwork") {
    const current = linkedResearchLabSlotSummary(currentLevel, options.researchNetworkLabLevels ?? []);
    const next = linkedResearchLabSlotSummary(currentLevel + 1, options.researchNetworkLabLevels ?? []);
    const delta = next.linkedCount > current.linkedCount || next.linkedLevelTotal > current.linkedLevelTotal
      ? `+${next.linkedCount - current.linkedCount} linked`
      : undefined;
    return [{
      current: current.label,
      ...(delta ? { delta } : {}),
      next: next.label,
      target: "Linked research labs",
    }];
  }

  if (key === "weapons") {
    return [percentMultiplierRow("Ship and defense attack", currentLevel, currentLevel + 1)];
  }

  if (key === "shielding") {
    return [percentMultiplierRow("Ship and defense shields", currentLevel, currentLevel + 1)];
  }

  if (key === "armor") {
    return [percentMultiplierRow("Ship and defense hull", currentLevel, currentLevel + 1)];
  }

  return [];
}

export function researchUnlockRows(key: ResearchKey): string[] {
  const rows: string[] = [];

  for (const building of buildingCatalog) {
    for (const requirement of buildingRequirementsFor(building.key)) {
      if (requirement.type === "research" && requirement.key === key) {
        rows.push(`${building.label} at Level ${requirement.level}`);
      }
    }
  }

  // VEY-KANEO-493: use the buildable subset so shipyard-hidden ships (the expedition-only
  // `pathfinder` slot) never surface as a research unlock in player-readable copy.
  for (const ship of shipyardCatalog) {
    for (const requirement of ship.requirements) {
      if (requirement.kind === "technology" && requirement.key === key) {
        rows.push(`${ship.label} at Level ${requirement.level}`);
      }
    }
  }

  for (const defense of defenseCatalog) {
    for (const requirement of defense.requirements) {
      if (requirement.kind === "technology" && requirement.key === key) {
        rows.push(`${defense.label} at Level ${requirement.level}`);
      }
    }
  }

  for (const research of researchCatalog) {
    for (const requirement of researchRequirementsFor(research.key)) {
      if (requirement.type === "research" && requirement.key === key) {
        rows.push(`${research.label} at Level ${requirement.level}`);
      }
    }
  }

  return uniqueBy(rows, (row) => row);
}

const BPS = 10_000;
export const QUEUE_UNIVERSE_SPEED = 1;
const MIN_QUEUE_SECONDS = 1;
const PLANET = {
  fields: 206,
  maxTemperature: -12,
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
      fusionReactor: 0,
      naniteFactory: 0,
      terraformer: 0,
      allianceDepot: 0,
      missileSilo: 0,
      interdimensionalRiftStabilizer: 0,
    },
    research: {
      energy: 0,
      laser: 0,
      ion: 0,
      combustionDrive: 0,
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
      bomber: 0,
      solarSatellite: 0,
      destroyer: 0,
      deathstar: 0,
      battlecruiser: 0,
      reaper: 0,
      pathfinder: 0,
      crawler: 0,
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
  energyTechnologyLevel = 0,
  solarSatelliteCount = 0,
): Resources {
  const energy = energyBalance(buildings, energyTechnologyLevel, solarSatelliteCount, profile);

  const capacity = productionCapacityPerHour(buildings, profile);

  return {
    metal: scaleByBps(capacity.metal, energy.scaleBps),
    crystal: scaleByBps(capacity.crystal, energy.scaleBps),
    deuterium: scaleByBps(Math.max(0, capacity.deuterium - energy.deuteriumConsumed), energy.scaleBps),
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

export function energyBalance(
  buildings: Record<BuildingKey, number>,
  energyTechnologyLevel = 0,
  solarSatelliteCount = 0,
  profile: PlanetProductionProfile = PLANET,
): EnergyBalance {
  const required = (
    scaledLevelValue(10, buildings.metalMine)
    + scaledLevelValue(10, buildings.crystalMine)
    + scaledLevelValue(20, buildings.deuteriumSynthesizer)
  );
  const solarPlant = scaledLevelValue(20, buildings.solarPlant);
  const fusionReactor = fusionReactorEnergyProduction(buildings.fusionReactor, energyTechnologyLevel);
  const fusionReactorDeuteriumConsumed = fusionReactorDeuteriumConsumption(buildings.fusionReactor);
  const solarSatelliteEnergyPerUnit = solarSatelliteEnergy(profile.maxTemperature ?? PLANET.maxTemperature);
  const solarSatellites = solarSatelliteEnergyPerUnit * solarSatelliteCount;
  const produced = solarPlant + fusionReactor + solarSatellites;

  return {
    deuteriumConsumed: fusionReactorDeuteriumConsumed,
    produced,
    required,
    scaleBps: required === 0 || produced >= required
      ? BPS
      : Math.floor((produced * BPS) / required),
    sources: {
      solarPlant,
      fusionReactor,
      fusionReactorDeuteriumConsumed,
      solarSatellites,
      solarSatelliteCount,
      solarSatelliteEnergy: solarSatelliteEnergyPerUnit,
    },
  };
}

export function buildingEnergyProduction(
  buildings: Record<BuildingKey, number>,
  key: Extract<BuildingKey, "solarPlant" | "fusionReactor">,
  energyTechnologyLevel = 0,
  profile: PlanetProductionProfile = PLANET,
): number {
  const sources = energyBalance(buildings, energyTechnologyLevel, 0, profile).sources;
  return key === "solarPlant" ? sources?.solarPlant ?? 0 : sources?.fusionReactor ?? 0;
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
  energyTechnologyLevel = 0,
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

  if (key === "solarPlant" || key === "fusionReactor") {
    const currentProduced = buildingEnergyProduction(buildings, key, energyTechnologyLevel, profile);
    const nextProduced = buildingEnergyProduction(nextBuildings, key, energyTechnologyLevel, profile);
    const currentDeuteriumConsumed = fusionReactorDeuteriumConsumption(buildings.fusionReactor);
    const nextDeuteriumConsumed = fusionReactorDeuteriumConsumption(nextBuildings.fusionReactor);

    return {
      kind: "energy",
      currentDeuteriumConsumed,
      currentProduced,
      deltaDeuteriumConsumed: nextDeuteriumConsumed - currentDeuteriumConsumed,
      deltaProduced: nextProduced - currentProduced,
      nextDeuteriumConsumed,
      nextProduced,
      required: energyBalance(buildings, energyTechnologyLevel, 0, profile).required,
      showsDeuteriumConsumption: key === "fusionReactor",
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

  if (key === "missileSilo") {
    const currentSlots = missileSiloCapacity(buildings.missileSilo);
    const nextSlots = missileSiloCapacity(nextBuildings.missileSilo);

    return {
      kind: "missileSilo",
      currentSlots,
      nextSlots,
      deltaSlots: nextSlots - currentSlots,
    };
  }

  if (key === "allianceDepot") {
    const currentSupport = allianceDepotSupportCapacity(buildings.allianceDepot);
    const nextSupport = allianceDepotSupportCapacity(nextBuildings.allianceDepot);

    return {
      kind: "allianceDepot",
      currentSupport,
      nextSupport,
      deltaSupport: nextSupport - currentSupport,
    };
  }

  if (key === "roboticsFactory" || key === "naniteFactory") {
    const currentFactor = key === "naniteFactory"
      ? 2 ** buildings.naniteFactory
      : buildings.roboticsFactory + 1;
    const nextFactor = key === "naniteFactory"
      ? 2 ** nextBuildings.naniteFactory
      : nextBuildings.roboticsFactory + 1;

    return {
      kind: "constructionSpeed",
      currentFactor,
      nextFactor,
      relativeImprovementPercent: Math.round(((nextFactor - currentFactor) / currentFactor) * 100),
    };
  }

  if (key === "shipyard") {
    const currentFactor = Math.max(1, buildings.shipyard + 1);
    const nextFactor = nextBuildings.shipyard + 1;

    return {
      kind: "shipyard",
      currentFactor,
      nextFactor,
      relativeImprovementPercent: Math.round(((nextFactor / currentFactor) - 1) * 100),
      unlocked: buildings.shipyard > 0,
      nextUnlocked: nextBuildings.shipyard > 0,
    };
  }

  if (key === "researchLab") {
    return {
      kind: "researchSpeed",
      currentFactor: Math.max(1, buildings.researchLab),
      nextFactor: Math.max(1, nextBuildings.researchLab),
      unlocked: buildings.researchLab > 0,
      nextUnlocked: nextBuildings.researchLab > 0,
    };
  }

  if (key === "terraformer") {
    const currentFieldsAdded = buildings.terraformer * 5;
    const nextFieldsAdded = nextBuildings.terraformer * 5;

    return {
      kind: "terraformer",
      currentFieldsAdded,
      nextFieldsAdded,
      deltaFields: nextFieldsAdded - currentFieldsAdded,
    };
  }

  if (key === "interdimensionalRiftStabilizer") {
    return {
      kind: "facility",
      currentLevel: buildings[key],
      nextLevel: 1,
      label: "Rift Stabilizer",
      binary: true,
    };
  }

  return {
    kind: "facility",
    currentLevel: buildings[key],
    nextLevel: nextBuildings[key],
    label: "Catalog facility",
  };
}

export function missileSiloCapacity(level: number): number {
  return level * 10;
}

export function allianceDepotSupportCapacity(level: number): number {
  return level * 20_000;
}

export function researchCost(
  research: Record<ResearchKey, number>,
  key: ResearchKey,
): Resources {
  const entry = researchCatalog.find((item) => item.key === key);
  if (!entry) {
    throw new Error(`Unknown research: ${key}`);
  }

  if (key === "astrophysics") {
    return scaleResearchCost(entry.baseCost, research[key], 1.75);
  }

  if (key === "graviton") {
    return { metal: 0, crystal: 0, deuterium: 0 };
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

export function researchLabRequirementFor(key: ResearchKey): number {
  let requiredLevel = 0;
  for (const requirement of researchRequirementsFor(key)) {
    if (requirement.type === "building" && requirement.key === "researchLab") {
      requiredLevel = Math.max(requiredLevel, requirement.level);
    }
  }
  return requiredLevel;
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
  state: Pick<PlayableState, "buildings" | "research" | "ships">,
  key: ResearchKey,
): ResearchRequirement | undefined {
  return researchRequirementsFor(key).find((requirement) => {
    if (requirement.type === "building") {
      return state.buildings[requirement.key] < requirement.level;
    }

    if (requirement.type === "energy") {
      return energyBalance(
        state.buildings,
        state.research.energy,
        state.ships.solarSatellite,
      ).produced < requirement.produced;
    }

    return state.research[requirement.key] < requirement.level;
  });
}

export function missingUnlockRequirements(
  requirements: UnlockRequirement[],
  levels: {
    buildings?: Partial<Record<UnlockBuildingKey, number>> | undefined;
    research?: Partial<Record<ResearchKey, number>> | undefined;
  },
): string[] {
  const missing = uniqueUnlockRequirements(requirements).flatMap((requirement) => {
    const actual = requirement.kind === "building"
      ? levels.buildings?.[requirement.key as UnlockBuildingKey] ?? 0
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
  const highestLevelByKey = new Map<string, number>();
  for (const requirement of requirements) {
    if (requirement.type === "energy") {
      continue;
    }

    const key = `${requirement.type}:${requirement.key}`;
    highestLevelByKey.set(key, Math.max(highestLevelByKey.get(key) ?? 0, requirement.level));
  }

  return uniqueBy(
    requirements.filter((requirement) => (
      requirement.type === "energy"
        || requirement.level === highestLevelByKey.get(`${requirement.type}:${requirement.key}`)
    )),
    (requirement) => (
      requirement.type === "energy"
        ? `${requirement.type}:${requirement.produced}`
        : `${requirement.type}:${requirement.key}:${requirement.level}`
    ),
  );
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
  options: {
    networkLevel?: number | undefined;
    requiredLabLevel?: number | undefined;
    researchNetworkLabLevels?: readonly number[] | undefined;
    universeSpeed?: number | undefined;
  } = {},
): number {
  const labLevel = effectiveResearchLabLevel(buildings.researchLab, {
    networkLevel: options.networkLevel ?? 0,
    requiredLabLevel: options.requiredLabLevel ?? 0,
    researchNetworkLabLevels: options.researchNetworkLabLevels ?? [],
  });
  return researchDurationSeconds(labLevel, cost, options.universeSpeed);
}

export function buildingDurationEstimate(
  buildings: Record<BuildingKey, number>,
  cost: Resources,
): number {
  return buildingDurationSeconds(buildings.roboticsFactory, buildings.naniteFactory, cost);
}

export function shipDurationEstimate(
  shipyardLevel: number,
  naniteLevel: number,
  cost: Resources,
  quantity = 1,
): number {
  return shipDurationSeconds(shipyardLevel, naniteLevel, cost, quantity);
}

export function defenseDurationEstimate(
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

export function queueProgress(queue: QueueTimeline | undefined, now = Date.now()): number {
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

export function queueProgressPercent(queue: QueueTimeline | undefined, now = Date.now()): number {
  return Math.round(queueProgress(queue, now) * 100);
}

export function progress(queue: QueueItem | undefined, now = Date.now()): number {
  return queueProgress(queue, now);
}

export function planetSummary() {
  return PLANET;
}

function scaleByLevel(cost: Resources, currentLevel: number): Resources {
  return scaleResearchCost(cost, currentLevel, 2);
}

function scaleResearchCost(cost: Resources, currentLevel: number, factor: 2 | 1.75): Resources {
  if (factor === 1.75) {
    return {
      metal: roundToNearestHundred(cost.metal * (1.75 ** currentLevel)),
      crystal: roundToNearestHundred(cost.crystal * (1.75 ** currentLevel)),
      deuterium: roundToNearestHundred(cost.deuterium * (1.75 ** currentLevel)),
    };
  }

  return multiply(cost, 2 ** currentLevel);
}

function scaleBuildingCost(cost: Resources, key: BuildingKey, currentLevel: number): Resources {
  if (isBinaryBuilding(key)) {
    return cost;
  }

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

  if (key === "fusionReactor") {
    return [18, 10];
  }

  return [2, 1];
}

function scaledLevelValue(base: number, level: number): number {
  if (level === 0) return 0;
  return Math.floor((base * level * (11 ** level)) / (10 ** level));
}

export function fusionReactorEnergyProduction(level: number, energyTechnologyLevel: number): number {
  if (level === 0) return 0;
  return Math.floor((30 * level * ((105 + energyTechnologyLevel) ** level)) / (100 ** level));
}

export function fusionReactorDeuteriumConsumption(level: number): number {
  if (level === 0) return 0;
  return Math.ceil((10 * level * (11 ** level)) / (10 ** level));
}

export const solarSatelliteEnergy = universeSolarSatelliteEnergy;

function scaleByFactor(value: number, exponent: number, numerator: number, denominator: number): number {
  return Math.floor((value * (numerator ** exponent)) / (denominator ** exponent));
}

function roundToNearestHundred(value: number): number {
  return Math.round(value / 100) * 100;
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
  1_804_604_750_000,
  3_308_193_270_000,
  6_064_564_940_000,
  11_117_533_015_000,
  20_380_611_235_000,
  37_361_644_330_000,
  68_491_197_375_000,
  125_557_753_210_000,
  230_171_905_210_000,
  421_950_095_435_000,
  773_517_006_225_000,
  1_418_007_876_745_000,
  2_599_485_625_175_000,
  4_765_365_289_085_000,
  8_735_846_091_420_000,
  16_014_513_537_450_000,
  29_357_733_773_850_000,
  53_818_464_752_040_000,
  98_659_766_131_065_000,
  180_862_636_975_685_000,
];

function storageCap(level: number): number {
  return STORAGE_CAPS[level] ?? STORAGE_CAPS[STORAGE_CAPS.length - 1]!;
}

function buildingDurationSeconds(roboticsLevel: number, naniteLevel: number, cost: Resources): number {
  const roboticsDivisor = roboticsLevel + 1;
  const naniteDivisor = 2 ** naniteLevel;
  const raw = Math.floor(
    ((cost.metal + cost.crystal) * 3_600)
      / (2_500 * roboticsDivisor * naniteDivisor * QUEUE_UNIVERSE_SPEED),
  );
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function researchDurationSeconds(
  researchLabLevel: number,
  cost: Resources,
  universeSpeed = QUEUE_UNIVERSE_SPEED,
): number {
  const speed = Math.max(1, Math.floor(universeSpeed));
  const raw = Math.floor(((cost.metal + cost.crystal) * 3_600) / (1_000 * (researchLabLevel + 1) * speed));
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function shipDurationSeconds(shipyardLevel: number, naniteLevel: number, cost: Resources, quantity: number): number {
  const denominator = 2500 * (shipyardLevel + 1) * (2 ** naniteLevel) * QUEUE_UNIVERSE_SPEED;
  const raw = Math.ceil(((cost.metal + cost.crystal) * Math.max(1, Math.floor(quantity)) * 3_600) / denominator);
  return Math.max(MIN_QUEUE_SECONDS, raw);
}

function effectiveResearchLabLevel(
  localLabLevel: number,
  options: {
    networkLevel: number;
    requiredLabLevel: number;
    researchNetworkLabLevels: readonly number[];
  },
): number {
  const requiredLabLevel = Math.max(0, Math.floor(options.requiredLabLevel));
  if (localLabLevel < requiredLabLevel) return localLabLevel;

  const linkedCount = Math.max(0, Math.floor(options.networkLevel));
  if (linkedCount === 0) return localLabLevel;

  const linkedLabTotal = [...options.researchNetworkLabLevels]
    .filter((level) => level >= requiredLabLevel)
    .sort((left, right) => right - left)
    .slice(0, linkedCount)
    .reduce((total, level) => total + level, 0);

  return localLabLevel + linkedLabTotal;
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
