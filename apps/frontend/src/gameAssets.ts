import type { DefenseKey, ResearchKey, ShipKey } from "./playableMvp";

export type GameAssetMapping<Key extends string> = {
  key: Key;
  src: string;
  category: "ship" | "defense" | "research";
  status: "production" | "generated-preview";
  note?: string;
};

const SHIP_BASE = "/assets/game/style-pass/generated/ships";
const DEFENSE_BASE = "/assets/game/style-pass/generated/defenses";
const RESEARCH_BASE = "/assets/game/style-pass/generated/research";

export const shipAssetManifest = [
  { key: "smallCargo", src: `${SHIP_BASE}/small-cargo.webp`, category: "ship", status: "production" },
  { key: "lightFighter", src: `${SHIP_BASE}/light-fighter.webp`, category: "ship", status: "production" },
  { key: "recycler", src: `${SHIP_BASE}/recycler.webp`, category: "ship", status: "production" },
  { key: "colonyShip", src: `${SHIP_BASE}/colony-ship.webp`, category: "ship", status: "production" },
  { key: "largeCargo", src: `${SHIP_BASE}/large-cargo.webp`, category: "ship", status: "production" },
  { key: "heavyFighter", src: `${SHIP_BASE}/heavy-fighter.webp`, category: "ship", status: "production" },
  { key: "cruiser", src: `${SHIP_BASE}/cruiser.webp`, category: "ship", status: "production" },
  { key: "battleship", src: `${SHIP_BASE}/battleship.webp`, category: "ship", status: "production" },
  { key: "espionageProbe", src: `${SHIP_BASE}/espionage-probe.webp`, category: "ship", status: "production" },
  { key: "bomber", src: `${SHIP_BASE}/bomber.webp`, category: "ship", status: "production" },
  { key: "solarSatellite", src: `${SHIP_BASE}/solar-satellite.webp`, category: "ship", status: "production" },
  { key: "destroyer", src: `${SHIP_BASE}/destroyer.webp`, category: "ship", status: "production" },
  { key: "deathstar", src: `${SHIP_BASE}/deathstar.webp`, category: "ship", status: "production" },
  { key: "battlecruiser", src: `${SHIP_BASE}/battlecruiser.webp`, category: "ship", status: "production" },
  { key: "reaper", src: `${SHIP_BASE}/reaper.webp`, category: "ship", status: "production" },
  { key: "pathfinder", src: `${SHIP_BASE}/pathfinder.webp`, category: "ship", status: "production" },
  { key: "crawler", src: `${SHIP_BASE}/crawler.webp`, category: "ship", status: "generated-preview" },
] as const satisfies readonly GameAssetMapping<ShipKey>[];

export const researchAssetManifest = [
  { key: "energy", src: `${RESEARCH_BASE}/energy.webp`, category: "research", status: "generated-preview" },
  { key: "laser", src: `${RESEARCH_BASE}/laser.webp`, category: "research", status: "generated-preview" },
  { key: "ion", src: `${RESEARCH_BASE}/ion.webp`, category: "research", status: "generated-preview" },
  { key: "hyperspace", src: `${RESEARCH_BASE}/hyperspace.webp`, category: "research", status: "generated-preview" },
  { key: "plasma", src: `${RESEARCH_BASE}/plasma.webp`, category: "research", status: "generated-preview" },
  {
    key: "combustionDrive",
    src: `${RESEARCH_BASE}/combustion-drive.webp`,
    category: "research",
    status: "generated-preview",
  },
  {
    key: "impulseDrive",
    src: `${RESEARCH_BASE}/impulse-drive.webp`,
    category: "research",
    status: "generated-preview",
  },
  {
    key: "hyperspaceDrive",
    src: `${RESEARCH_BASE}/hyperspace-drive.webp`,
    category: "research",
    status: "generated-preview",
  },
  { key: "espionage", src: `${RESEARCH_BASE}/espionage.webp`, category: "research", status: "generated-preview" },
  { key: "computer", src: `${RESEARCH_BASE}/computer.webp`, category: "research", status: "generated-preview" },
  { key: "astrophysics", src: `${RESEARCH_BASE}/astrophysics.webp`, category: "research", status: "generated-preview" },
  {
    key: "intergalacticResearchNetwork",
    src: `${RESEARCH_BASE}/intergalactic-research-network.webp`,
    category: "research",
    status: "generated-preview",
  },
  { key: "graviton", src: `${RESEARCH_BASE}/graviton.webp`, category: "research", status: "generated-preview" },
  { key: "weapons", src: `${RESEARCH_BASE}/weapons.webp`, category: "research", status: "generated-preview" },
  { key: "shielding", src: `${RESEARCH_BASE}/shielding.webp`, category: "research", status: "generated-preview" },
  { key: "armor", src: `${RESEARCH_BASE}/armor.webp`, category: "research", status: "generated-preview" },
] as const satisfies readonly GameAssetMapping<ResearchKey>[];

export const defenseAssetManifest = [
  { key: "rocketLauncher", src: `${DEFENSE_BASE}/rocket-launcher.webp`, category: "defense", status: "generated-preview" },
  { key: "lightLaser", src: `${DEFENSE_BASE}/light-laser.webp`, category: "defense", status: "generated-preview" },
  { key: "heavyLaser", src: `${DEFENSE_BASE}/heavy-laser.webp`, category: "defense", status: "generated-preview" },
  { key: "smallShieldDome", src: `${DEFENSE_BASE}/small-shield-dome.webp`, category: "defense", status: "generated-preview" },
  { key: "gaussCannon", src: `${DEFENSE_BASE}/gauss-cannon.webp`, category: "defense", status: "generated-preview" },
  { key: "ionCannon", src: `${DEFENSE_BASE}/ion-cannon.webp`, category: "defense", status: "generated-preview" },
  { key: "plasmaTurret", src: `${DEFENSE_BASE}/plasma-turret.webp`, category: "defense", status: "generated-preview" },
  { key: "largeShieldDome", src: `${DEFENSE_BASE}/large-shield-dome.webp`, category: "defense", status: "generated-preview" },
  {
    key: "antiBallisticMissile",
    src: `${DEFENSE_BASE}/anti-ballistic-missile.webp`,
    category: "defense",
    status: "generated-preview",
  },
  {
    key: "interplanetaryMissile",
    src: `${DEFENSE_BASE}/interplanetary-missile.webp`,
    category: "defense",
    status: "generated-preview",
  },
] as const satisfies readonly GameAssetMapping<DefenseKey>[];

export const shipAssetByKey = Object.fromEntries(
  shipAssetManifest.map((asset) => [asset.key, asset.src]),
) as Record<ShipKey, string>;

export const defenseAssetByKey = Object.fromEntries(
  defenseAssetManifest.map((asset) => [asset.key, asset.src]),
) as Record<DefenseKey, string>;

export const researchAssetByKey = Object.fromEntries(
  researchAssetManifest.map((asset) => [asset.key, asset.src]),
) as Record<ResearchKey, string>;
