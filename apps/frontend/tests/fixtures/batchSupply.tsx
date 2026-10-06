// Local-only mounted production modal. No wallet, API, or production entrypoint.
import { render } from "preact";
import { useState } from "preact/hooks";
import { BatchSupplyModal } from "../../src/components/BatchSupplyModal";
import type { BatchSupplyOrder, BatchSupplySource, SupplyShipTypesBySource, SupplyMission } from "../../src/batchSupplyPlanner";
import type { ManagedPlanetResponse } from "../../src/walletFlow";
import type { WriteTransactionState } from "../../src/transactionActionGate";
import "../../src/styles.css";

const emptyFleet = new URLSearchParams(location.search).has("emptyFleet");
const recyclerOnly = new URLSearchParams(location.search).has("recyclerOnly");
const twoSources = new URLSearchParams(location.search).has("twoSources");
const plannedFleetExample = new URLSearchParams(location.search).has("plannedFleetExample");
const initialRequested = { metal: plannedFleetExample ? 34_900 : 1000, crystal: 0, deuterium: 0 };
const source: BatchSupplySource = {
  planetId: "188", label: "Astro", coordinates: { galaxy: 6, system: 9, position: 13 },
  resources: { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 },
  ships: emptyFleet ? {} : recyclerOnly ? { recycler: 5 } : plannedFleetExample ? { largeCargo: 5, recycler: 3 } : { largeCargo: 2, smallCargo: 3, recycler: 5, colonyShip: 1 },
  unavailableReason: emptyFleet ? "No usable cargo ships are available on this planet." : undefined,
  driveLevels: { combustionDrive: 6, impulseDrive: 4, hyperspaceDrive: 0 },
};
// Only the modal's presentation/route fields are consumed; this fixture does not load a wallet response.
const target = { planetId: "189", name: "Home", galaxy: 6, system: 9, position: 14, coordinates: "6:9:14" } as ManagedPlanetResponse;

declare global {
  interface Window {
    supplyFixture: {
      refresh: () => void;
      changeStock: () => void;
      pending: (kind: "action" | "transaction" | "none") => void;
      reject: () => void;
      reset: (kind: "draft" | "target" | "account") => void;
      submissions: Array<{ orders: BatchSupplyOrder[]; shipTypesBySource: SupplyShipTypesBySource; mission: SupplyMission }>;
    };
  }
}
const submissions: Window["supplyFixture"]["submissions"] = [];
function Fixture() {
  const [sources, setSources] = useState(twoSources ? [source, { ...source, planetId: "190", label: "Luna", coordinates: { ...source.coordinates, position: 12 }, ships: { smallCargo: 2, recycler: 3 } }] : [source]);
  const [draft, setDraft] = useState(0);
  const [account, setAccount] = useState("fixture-account");
  const [destination, setDestination] = useState(target);
  const [actionPending, setActionPending] = useState(false);
  const [transactionState, setTransactionState] = useState<WriteTransactionState>();
  window.supplyFixture = {
    submissions,
    refresh: () => setSources(current => current.map(item => ({ ...item, ships: { ...item.ships }, resources: { ...item.resources } }))),
    changeStock: () => setSources(current => current.map(item => ({ ...item, ships: { ...item.ships, smallCargo: 1 }, resources: { ...item.resources, metal: 500 } }))),
    pending: kind => {
      setActionPending(kind === "action");
      setTransactionState(kind === "transaction" ? { phase: "pending", label: "Awaiting wallet" } : undefined);
    },
    reject: () => { setActionPending(false); setTransactionState({ phase: "error", label: "Wallet request rejected" }); },
    reset: kind => {
      setTransactionState(undefined);
      setActionPending(false);
      if (kind === "draft") setDraft(value => value + 1);
      if (kind === "target") setDestination(value => ({ ...value, planetId: String(Number(value.planetId) + 1), name: "New target" }));
      if (kind === "account") setAccount(value => value + "-new");
    },
  };
  return <BatchSupplyModal key={account + ":" + destination.planetId + ":" + draft}
    target={destination} sources={sources} initialRequested={initialRequested} maxSources={15}
    actionPending={actionPending} transactionState={transactionState} onClose={() => setDraft(value => value + 1)}
    onConfirm={(orders, shipTypesBySource, mission) => submissions.push(structuredClone({ orders, shipTypesBySource, mission }))} />;
}
document.body.style.background = "#05070d";
render(<Fixture />, document.getElementById("app")!);
