// Local-only mounted production modal. No wallet, API, or production entrypoint.
import { render } from "preact";
import { useState } from "preact/hooks";
import { useVerifiedMoonSupplyBatch } from "../../src/moonSupplyBatch";
import { BatchSupplyModal } from "../../src/components/BatchSupplyModal";
import { MissionCargoPicker } from "../../src/components/MissionCreationPage";
import type { BatchSupplyOrder, BatchSupplySource, SupplyShipTypesBySource, SupplyMission, SupplyFleetModesBySource } from "../../src/batchSupplyPlanner";
import type { ManagedPlanetResponse } from "../../src/walletFlow";
import type { WriteTransactionState } from "../../src/transactionActionGate";
import "../../src/styles.css";

const combatOnlyFirst = new URLSearchParams(location.search).has("combatOnlyFirst");
const oneSlot = new URLSearchParams(location.search).has("oneSlot");
const combatFleet = new URLSearchParams(location.search).has("combatFleet");
const largeFleet = new URLSearchParams(location.search).has("largeFleet");
const moon = new URLSearchParams(location.search).has("moon");
const capabilityHook = new URLSearchParams(location.search).has("capabilityHook");
const capabilityContract = "0x2222222222222222222222222222222222222222";
let capabilityResponse: unknown = {version:1, gameContractAddress:capabilityContract, chainId:8453};
const originalFetch = window.fetch.bind(window);
if (capabilityHook) window.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === "https://moon-capability.fixture.invalid/moon-supply-batch" ? Response.json(capabilityResponse) : originalFetch(input, init), originalFetch);
const emptyFleet = new URLSearchParams(location.search).has("emptyFleet");
const recyclerOnly = new URLSearchParams(location.search).has("recyclerOnly");
const twoSources = new URLSearchParams(location.search).has("twoSources");
const plannedFleetExample = new URLSearchParams(location.search).has("plannedFleetExample");
const denver = new URLSearchParams(location.search).has("denver");
const initialRequested = denver ? { metal: 12300, crystal: 3340, deuterium: 6400 } : { metal: combatFleet ? 0 : plannedFleetExample ? 34_900 : 1000, crystal: 0, deuterium: 0 };
const source: BatchSupplySource = {
  planetId: moon ? "189" : "188", label: "Astro", coordinates: { galaxy: 6, system: 9, position: moon ? 14 : 13 },
  resources: { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 },
  ships: combatOnlyFirst ? { lightFighter: 5 } : combatFleet ? { largeCargo: 2, smallCargo: 3, recycler: 5, colonyShip: 1, lightFighter: 70, cruiser: 12 } : emptyFleet ? {} : recyclerOnly ? { recycler: 5 } : plannedFleetExample ? { largeCargo: 5, recycler: 3 } : { largeCargo: 2, smallCargo: 3, recycler: 5, colonyShip: 1 },
  unavailableReason: emptyFleet ? "No usable cargo ships are available on this planet." : undefined,
  driveLevels: { combustionDrive: 6, impulseDrive: 4, hyperspaceDrive: 0 },
};
// Only the modal's presentation/route fields are consumed; this fixture does not load a wallet response.
const target = denver ? { planetId: "831", name: "New Denver", galaxy: 6, system: 9, position: 12, coordinates: "6:9:12" } as ManagedPlanetResponse : { planetId: "189", name: "Home", galaxy: 6, system: 9, position: 14, coordinates: "6:9:14" } as ManagedPlanetResponse;

declare global {
  interface Window {
    supplyFixture: {
      refresh: () => void;
      effectiveCargo: (count: number) => void;
      unmount: () => void;
      changeStock: () => void;
      harmlessStock: () => void;
      accrueStock: () => void;
      changeEligibility: () => void;
      changeDrives: () => void;
      changeRoute: () => void;
      changeBody: () => void;
      changeLimit: () => void;
      pending: (kind: "action" | "transaction" | "none") => void;
      reject: () => void;
      preflightFailed: () => void;
      reset: (kind: "draft" | "target" | "account") => void;
      capability: (supported: boolean) => void;
      submissions: Array<{ orders: BatchSupplyOrder[]; shipTypesBySource: SupplyShipTypesBySource; mission: SupplyMission; fleetModesBySource: SupplyFleetModesBySource }>;
    };
  }
}
const submissions: Window["supplyFixture"]["submissions"] = [];
function Fixture() {
  const [sources, setSources] = useState(denver ? [
    { ...source, planetId: "astro", resources: { metal: 0, crystal: 0, deuterium: 4825 } },
    { ...source, planetId: "montreal", label: "Montreal", coordinates: { galaxy: 6, system: 9, position: 10 }, resources: { metal: 11181, crystal: 5000, deuterium: 2000 } },
    { ...source, planetId: "1", label: "New Zion", coordinates: { galaxy: 6, system: 9, position: 1 }, resources: { metal: 1133873, crystal: 855054, deuterium: 54388 }, ships: { largeCargo: 20 }, driveLevels: { combustionDrive: 8, impulseDrive: 6, hyperspaceDrive: 7 } },
  ] : largeFleet ? Array.from({ length: 15 }, (_, i) => ({
    ...source, planetId: String(200 + i), label: `Source ${i}`,
    coordinates: { galaxy: 6, system: 10 + i, position: 14 },
    resources: { metal: 250_000_000, crystal: 0, deuterium: 10 },
    ships: { largeCargo: 10_000 }, driveLevels: {},
  })) : (twoSources || combatOnlyFirst) ? [source, { ...source, planetId: "190", label: "Luna", coordinates: { ...source.coordinates, position: 12 }, ships: { smallCargo: 2, recycler: 3 } }] : [source]);
  const [draft, setDraft] = useState(0);
  const [account, setAccount] = useState("fixture-account");
  const [destination, setDestination] = useState(target);
  const [targetIsMoon, setTargetIsMoon] = useState(moon);
  const [maxSources, setMaxSources] = useState(oneSlot ? 1 : 15);
  const [moonBatchSupported, setMoonBatchSupported] = useState(true);
  const verified = useVerifiedMoonSupplyBatch("https://moon-capability.fixture.invalid", capabilityHook && moonBatchSupported, capabilityContract, 8453);
  const [actionPending, setActionPending] = useState(false);
  const [transactionState, setTransactionState] = useState<WriteTransactionState>();
  const [error, setError] = useState<string>();
  window.supplyFixture = {
    submissions,
    capability: supported => { capabilityResponse = {version: supported ? 1 : null, gameContractAddress:capabilityContract, chainId:8453}; setMoonBatchSupported(supported); },
    effectiveCargo: count => setSources(current => current.map(item => ({ ...item, ships: { largeCargo: count }, unavailableReason: count ? undefined : "No usable cargo ships are available on this planet." }))),
    unmount: () => render(null, document.getElementById("app")!),
    refresh: () => setSources(current => current.map(item => ({ ...item, ships: { ...item.ships }, resources: { ...item.resources } }))),
    accrueStock: () => setSources(current => current.map(item => ({ ...item, resources: { metal: item.resources.metal + 100, crystal: item.resources.crystal + 100, deuterium: item.resources.deuterium + 100 } }))),
    harmlessStock: () => setSources(current => current.map(item => item.planetId === "1"
      ? { ...item, resources: { metal: 500000, crystal: 500000, deuterium: 10000 }, ships: { ...item.ships, lightFighter: 1000 } }
      : { ...item, unavailableReason: "Unrelated source locked", ships: {}, resources: { metal: 0, crystal: 0, deuterium: 0 } })),
    changeStock: () => setSources(current => current.map(item => ({ ...item, ships: { ...item.ships, smallCargo: 1 }, resources: { ...item.resources, metal: 500 } }))),
    changeEligibility: () => setSources(current => current.map(item => ({ ...item, unavailableReason: "Fleet unavailable" }))),
    changeDrives: () => setSources(current => current.map(item => ({ ...item, driveLevels: { ...item.driveLevels, combustionDrive: 7 } }))),
    changeRoute: () => setDestination(value => ({ ...value, system: value.system + 1 })),
    changeBody: () => setTargetIsMoon(value => !value),
    changeLimit: () => setMaxSources(value => value === 1 ? 15 : 1),
    pending: kind => {
      setActionPending(kind === "action");
      setTransactionState(kind === "transaction" ? { phase: "pending", label: "Awaiting wallet" } : undefined);
    },
    preflightFailed: () => setError("Need 6 Large Cargo, only 0 available on the origin planet."),
    reject: () => { setActionPending(false); setTransactionState({ phase: "error", label: "Wallet request rejected" }); },
    reset: kind => {
      setTransactionState(undefined);
      setActionPending(false);
      if (kind === "draft") setDraft(value => value + 1);
      if (kind === "target") setDestination(value => ({ ...value, planetId: String(Number(value.planetId) + 1), name: "New target" }));
      if (kind === "account") setAccount(value => value + "-new");
    },
  };
  return <BatchSupplyModal moonBatchSupported={capabilityHook ? verified : moonBatchSupported} key={account + ":" + destination.planetId + ":" + draft}
    upgrade={denver ? { kind: "building", key: "roboticsFactory", label: "Robotics Factory", level: 6 } : undefined}
    preview={denver ? { requirement: { metal: 12800, crystal: 3840, deuterium: 6400 }, missing: { metal: 12300, crystal: 3340, deuterium: 6400 }, energyOnly: false } : undefined}
    target={destination} sources={sources} initialRequested={initialRequested} targetIsMoon={targetIsMoon} maxSources={maxSources}
    error={error} actionPending={actionPending} transactionState={transactionState} onClose={() => setDraft(value => value + 1)}
    onConfirm={(orders, shipTypesBySource, mission, fleetModesBySource) => submissions.push(structuredClone({ orders, shipTypesBySource, mission, fleetModesBySource }))} />;
}
function NormalTransportFixture() {
  const [cargo, setCargo] = useState({ metal: "750", crystal: "200", deuterium: "100" });
  const [resources, setResources] = useState({ metal: 750, crystal: 1_200, deuterium: 900 });
  return <section aria-label="Normal transport cargo" className="p-4">
    <button onClick={() => setResources(current => ({ ...current, metal: current.metal === 750 ? 751 : 750 }))}>Refresh stock</button>
    <MissionCargoPicker cargo={cargo} cargoCapacity={2_000} maxCargoResources={resources} onCargoChange={setCargo} />
  </section>;
}
document.body.style.background = "#05070d";
render(new URLSearchParams(location.search).has("normal") ? <NormalTransportFixture /> : <Fixture />, document.getElementById("app")!);
