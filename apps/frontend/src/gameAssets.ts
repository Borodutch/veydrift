import type { DefenseKey, ShipKey } from "./playableMvp";

export type GameAssetMapping<Key extends string> = {
  key: Key;
  src: string;
  category: "ship" | "defense";
  status: "production" | "generated-preview";
  note?: string;
};

const SHIP_BASE = "/assets/game/ships";
const DEFENSE_BASE = "/assets/game/style-pass/generated/defenses";

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
] as const satisfies readonly GameAssetMapping<ShipKey>[];

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
