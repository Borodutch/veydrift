// Local-only production components with fixture snapshots; no wallet or launch transport.
import { render } from "preact";
import { useState } from "preact/hooks";
import { LevelInfoModal } from "../../src/components/LevelInfoModal";
import { buildingLevelInfoTable } from "../../src/components/InfrastructurePage";
import { ResearchLevelInfoModal, researchLevelInfoRows } from "../../src/components/ResearchPage";
import { moonStructureLevelInfoRows, moonStructureLevelInfoTable } from "../../src/components/MoonPage";
import { BatchSupplyModal } from "../../src/components/BatchSupplyModal";
import { buildingLevelInfoRows } from "../../src/buildingDetails";
import { buildingContractIds, createInitialPlayableState, researchCatalog } from "../../src/playableMvp";
import { levelSupplyPreview, levelSupplyCost, type LevelSupplyPreview, type LevelSupplyRequest } from "../../src/levelSupply";
import type { ManagedPlanetResponse, ChainInfrastructureState } from "../../src/walletFlow";
import "../../src/styles.css";

const kind = new URLSearchParams(location.search).get("kind") ?? "building";
const key = kind === "research" ? "energy" : kind === "binary" ? "interdimensionalRiftStabilizer" : "roboticsFactory";
const label = kind === "research" ? "Energy Technology" : kind === "binary" ? "Rift Stabilizer" : "Robotics Factory";
const currentLevel = kind === "binary" ? 0 : 8;
const request = { kind: kind === "binary" ? "building" : kind, key, label, level: currentLevel + 1 } as LevelSupplyRequest;
const cost = Object.fromEntries(Object.entries(levelSupplyCost(request)).map(([key, value]) => [key, String(value)]));
const state = createInitialPlayableState(); state.buildings.roboticsFactory = 8; state.research.energy = 8;
const target = { planetId: "7", name: "Destination", galaxy: 1, system: 1, position: 2, coordinates: "1:1:2" } as ManagedPlanetResponse;
let resources = { metal: "2400", crystal: "720", deuterium: "1200" };
let launches = 0;
function snapshot() {
  return { wallet: "fixture", planetId: "7", homePlanetId: "1", moon: { planetId: "7", exists: true }, resourcesAsOfNow: resources,
    buildings: [{ id: buildingContractIds[key as keyof typeof buildingContractIds], key, label, level: currentLevel, cost }],
    technologies: [{ id: researchCatalog.find(row => row.key === "energy")!.id, level: currentLevel, cost }], queue: { active: true },
  } as unknown as ChainInfrastructureState;
}
function Fixture() {
  const [selected, setSelected] = useState<LevelSupplyRequest>();
  const [preview, setPreview] = useState<LevelSupplyPreview>();
  const [error, setError] = useState<string>();
  const open = (level: number) => {
    const selection = { ...request, level }; setSelected(selection); setError(undefined);
    try { setPreview(levelSupplyPreview(selection, snapshot(), "7")); }
    catch (error) { setPreview(undefined); setError(String(error)); }
  };
  (window as any).levelFixture = { launches: () => launches,
    full: () => { resources = Object.fromEntries(Object.entries(levelSupplyCost(selected!)).map(([key, value]) => [key, String(value)])) as typeof resources; },
    spend: () => { resources = { metal: "0", crystal: "0", deuterium: "0" }; },
  };
  const rows = buildingLevelInfoRows(state.buildings, kind === "research" ? "roboticsFactory" : key as any);
  const table = kind === "moon" ? moonStructureLevelInfoTable("roboticsFactory", currentLevel,
    moonStructureLevelInfoRows({ id: 1, key: "roboticsFactory", label, level: 8, cost: cost as any }, { exists: true, planetId: "7" } as any, null), open)
    : buildingLevelInfoTable(currentLevel, kind === "binary" ? rows.slice(0, 1) : rows, open);
  return <>
    {kind === "research" ? <ResearchLevelInfoModal currentLevel={8} researchLabel={label} rows={researchLevelInfoRows(state, "energy")} onClose={() => {}} onSupply={open} />
      : <LevelInfoModal {...table} itemLabel={label} onClose={() => {}} />}
    {selected ? <BatchSupplyModal target={target} upgrade={selected} preview={preview} error={error}
      initialRequested={preview?.missing} maxSources={kind === "moon" ? 1 : 3}
      sources={[{ planetId: "1", label: "Source", coordinates: { galaxy: 1, system: 1, position: 1 }, resources: { metal: 10000000, crystal: 10000000, deuterium: 10000000 }, ships: { largeCargo: 1000, recycler: 10 }, driveLevels: { combustionDrive: 6, impulseDrive: 4, hyperspaceDrive: 0 } }]}
      onClose={() => setSelected(undefined)} onRefresh={() => open(selected.level)} onConfirm={() => { launches++; }} /> : null}
  </>;
}
render(<Fixture />, document.getElementById("app")!);
