// Local-only planet and moon building views with the inline Demolish icon (#120); no wallet.
import { render } from "preact";
import { InfrastructurePage } from "../../src/components/InfrastructurePage";
import { MoonPage } from "../../src/components/MoonPage";
import { constructionProgressForQueue } from "../../src/constructionProgress";
import { buildingContractIds, createInitialPlayableState } from "../../src/playableMvp";
import type { ChainMoonState, QueueStateResponse } from "../../src/walletFlow";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "planet";
// "blocked" leaves no resources, so Demolish is unavailable with a shortfall reason.
const blocked = params.get("state") === "blocked";
// "demolishing" runs a demolition one third of the way through; "finished" is
// that demolition after the backend reported it complete (#121 reconciliation).
const demolitionState = params.get("state") === "demolishing" || params.get("state") === "finished"
  ? params.get("state") as "demolishing" | "finished"
  : undefined;
const plenty = blocked ? "0" : "100000000";
const now = 1_800_000_000_000;
const calls = { cancel: 0, demolish: 0, upgrade: 0 };
(window as any).demolishFixture = { calls };

// The demolition comes from a backend queue read, projected through the same
// shared construction progress that drives the active queue panel.
function demolitionQueue(itemId: number, targetLevel: number): QueueStateResponse | null {
  if (!demolitionState) return null;
  const finished = demolitionState === "finished";
  const startedAt = finished ? now - 240_000 : now - 60_000;
  const readyAt = finished ? now - 60_000 : now + 120_000;
  return {
    action: "demolish",
    active: true,
    asOfNow: { complete: finished, secondsRemaining: Math.max(0, (readyAt - now) / 1_000) },
    cost: { metal: "0", crystal: "0", deuterium: "0" },
    itemId,
    kind: "building",
    readyAt: String(readyAt / 1_000),
    startedAt: String(startedAt / 1_000),
    targetLevel,
  } as QueueStateResponse;
}

function PlanetView() {
  const state = createInitialPlayableState(now);
  state.buildings.metalMine = 6;
  state.buildings.solarPlant = 6;
  state.buildings.roboticsFactory = 2;
  state.resources = blocked ? { metal: 0, crystal: 0, deuterium: 0 } : { metal: 1e8, crystal: 1e8, deuterium: 1e8 };
  const queue = demolitionQueue(buildingContractIds.metalMine, 5);
  // Like PlayableMvpApp, the page's building queue is the projected one, which a
  // backend-complete demolition no longer carries.
  if (queue && demolitionState === "demolishing") {
    state.queue = { demolish: true, key: "metalMine", kind: "building", label: "Metal Mine", readyAt: Number(queue.readyAt) * 1_000, startedAt: Number(queue.startedAt) * 1_000, targetLevel: 5 };
  }
  return (
    <InfrastructurePage
      // Blocked planets also show the Supply shortfall button, so the row carries three controls.
      chainCosts={{ metalMine: { metal: 683, crystal: 170, deuterium: 0 } }}
      constructionProgress={queue ? constructionProgressForQueue({ bodyKind: "planet", kind: "building", now, planetId: "7", queue }) : undefined}
      hasLoadedInfrastructureState
      now={now}
      onCancelDemolition={() => { calls.cancel++; }}
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
      { id: 1, key: "roboticsFactory", label: "Robotics Factory", level: 3, cost, durationSeconds: 600 },
      { id: 0, key: "lunarBase", label: "Lunar Base", level: 1, cost, durationSeconds: 600 },
    ],
    resources: { metal: plenty, crystal: plenty, deuterium: plenty },
    resourcesAsOfNow: { metal: plenty, crystal: plenty, deuterium: plenty },
    queue: demolitionQueue(1, 2),
    defenses: [],
    defenseQueue: null,
  } as ChainMoonState;
  return (
    <MoonPage
      canTransact
      constructionProgress={moonState.queue ? constructionProgressForQueue({ bodyKind: "moon", kind: "moon-building", now, planetId: "7", queue: moonState.queue }) : undefined}
      moonState={moonState}
      now={now}
      onDemolishBuilding={() => { calls.demolish++; }}
      onStartBuilding={() => { calls.upgrade++; }}
    />
  );
}

render(<div className="mx-auto max-w-6xl p-3">{view === "moon" ? <MoonView /> : <PlanetView />}</div>, document.getElementById("app")!);
