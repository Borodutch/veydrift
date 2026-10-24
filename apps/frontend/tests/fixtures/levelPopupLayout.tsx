// Local-only: renders the real level popup for every structure so its layout can be measured.
import { render } from "preact";
import { buildingLevelInfoRows } from "../../src/buildingDetails";
import { buildingLevelInfoTable } from "../../src/components/InfrastructurePage";
import { LevelInfoModal } from "../../src/components/LevelInfoModal";
import { moonStructureLevelInfoRows, moonStructureLevelInfoTable } from "../../src/components/MoonPage";
import { ResearchLevelInfoModal, researchLevelInfoRows } from "../../src/components/ResearchPage";
import { buildingCatalog, createInitialPlayableState, isBinaryBuilding, type BuildingKey, type ResearchKey } from "../../src/playableMvp";
import "../../src/styles.css";

const CURRENT = 8;
const state = createInitialPlayableState();
type Case = { body: string; key: string; label: string; level?: number; energy?: number };
const cases: Case[] = [
  ...buildingCatalog.map((building) => ({ body: "planet", key: building.key as string, label: building.label })),
  // Late game: long energy/deuterium figures with deltas.
  { body: "planet", key: "fusionReactor", label: "Fusion Reactor (late)", level: 40, energy: 25 },
  ...(["lunarBase", "roboticsFactory", "shipyard", "jumpGate"] as const).map((key) => ({ body: "moon", key: key as string, label: `Moon ${key}` })),
  ...(["energy", "astrophysics"] as const).map((key) => ({ body: "research", key: key as string, label: key })),
];

function view(index: number) {
  const item = cases[index]!;
  if (item.body === "planet") {
    const key = item.key as BuildingKey;
    const binary = isBinaryBuilding(key);
    const buildings = { ...state.buildings, [key]: binary ? 0 : item.level ?? CURRENT };
    const rows = buildingLevelInfoRows(buildings, key, undefined, undefined, item.energy ?? 3);
    const table = buildingLevelInfoTable(buildings[key], binary ? rows.slice(0, 1) : rows, () => {}, binary ? "Build cost" : undefined);
    return <LevelInfoModal {...table} itemLabel={item.label} onClose={() => {}} />;
  }
  if (item.body === "moon") {
    const key = item.key as "lunarBase" | "roboticsFactory" | "shipyard" | "jumpGate";
    const level = key === "jumpGate" ? 0 : CURRENT;
    const building = { id: 0, key, label: item.label, level, cost: { metal: "0", crystal: "0", deuterium: "0" } };
    const rows = moonStructureLevelInfoRows(building as never, { exists: true, planetId: "7" } as never, null);
    return <LevelInfoModal {...moonStructureLevelInfoTable(key, level, rows, () => {})} itemLabel={item.label} onClose={() => {}} />;
  }
  const key = item.key as ResearchKey;
  const researched = { ...state, research: { ...state.research, [key]: CURRENT } };
  return <ResearchLevelInfoModal currentLevel={CURRENT} onClose={() => {}} onSupply={() => {}} researchLabel={item.label} rows={researchLevelInfoRows(researched, key, undefined)} />;
}

const root = document.getElementById("app")!;
(window as unknown as { levelPopup: unknown }).levelPopup = {
  cases,
  show(index: number) {
    render(null, root);
    render(view(index), root);
  },
};
