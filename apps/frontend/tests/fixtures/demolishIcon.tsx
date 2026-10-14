// Local-only planet and moon building views with the inline Demolish icon (#120); no wallet.
import { render } from "preact";
import { InfrastructurePage } from "../../src/components/InfrastructurePage";
import { MoonPage } from "../../src/components/MoonPage";
import { createInitialPlayableState } from "../../src/playableMvp";
import type { ChainMoonState } from "../../src/walletFlow";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "planet";
// "blocked" leaves no resources, so Demolish is unavailable with a shortfall reason.
const blocked = params.get("state") === "blocked";
const plenty = blocked ? "0" : "100000000";
const now = 1_800_000_000_000;
const calls = { demolish: 0, upgrade: 0 };
(window as any).demolishFixture = { calls };

function PlanetView() {
  const state = createInitialPlayableState(now);
  state.buildings.metalMine = 6;
  state.buildings.solarPlant = 6;
  state.buildings.roboticsFactory = 2;
  state.resources = blocked ? { metal: 0, crystal: 0, deuterium: 0 } : { metal: 1e8, crystal: 1e8, deuterium: 1e8 };
  return (
    <InfrastructurePage
      // Blocked planets also show the Supply shortfall button, so the row carries three controls.
      chainCosts={{ metalMine: { metal: 683, crystal: 170, deuterium: 0 } }}
      hasLoadedInfrastructureState
      now={now}
      onDemolish={() => { calls.demolish++; }}
      onSupply={() => undefined}
      onUpgrade={() => { calls.upgrade++; }}
      selectedBuildingKey="metalMine"
      settledState={state}
      spendableResources={state.resources}
      state={state}
    />
  );
}

function MoonView() {
  const cost = { metal: "800", crystal: "240", deuterium: "160" };
  const moonState: ChainMoonState = {
    wallet: "0x1111111111111111111111111111111111111111",
    homePlanetId: "7",
    moonAvailable: true,
    moon: { exists: true, planetId: "7", owner: "0x1111111111111111111111111111111111111111", fields: 12, diameterKm: 8000, createdAt: "0", jumpGateReadyAt: "0" },
    buildings: [
      { id: 2, key: "roboticsFactory", label: "Robotics Factory", level: 3, cost, durationSeconds: 600 },
      { id: 1, key: "lunarBase", label: "Lunar Base", level: 1, cost, durationSeconds: 600 },
    ],
    resources: { metal: plenty, crystal: plenty, deuterium: plenty },
    resourcesAsOfNow: { metal: plenty, crystal: plenty, deuterium: plenty },
    queue: null,
    defenses: [],
    defenseQueue: null,
  } as ChainMoonState;
  return (
    <MoonPage
      canTransact
      moonState={moonState}
      now={now}
      onDemolishBuilding={() => { calls.demolish++; }}
      onStartBuilding={() => { calls.upgrade++; }}
    />
  );
}

render(<div className="mx-auto max-w-6xl p-3">{view === "moon" ? <MoonView /> : <PlanetView />}</div>, document.getElementById("app")!);
