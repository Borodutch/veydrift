// Local fixture mounts the exact production action hook and modal. Only indexed
// reads and the transaction coordinator/provider are mocks; no network or wallet.
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { BatchSupplyModal } from "../../src/components/BatchSupplyModal";
import { batchSupplySourceForPlanet, useBatchSupplyActions } from "../../src/PlayableMvpApp";
import { levelSupplyPreview, type LevelSupplyPreview, type LevelSupplyRequest } from "../../src/levelSupply";
import { buildingContractIds } from "../../src/playableMvp";
import { defaultVeydriftChainForLocation, type ManagedPlanetResponse } from "../../src/walletFlow";
import type { BackendDataStore } from "../../src/backendDataStore";
import "../../src/styles.css";

const wallet = "0x1111111111111111111111111111111111111111";
const target = { planetId: "831", name: "New Denver", galaxy: 6, system: 9, position: 12, coordinates: "6:9:12" } as ManagedPlanetResponse;
const request: LevelSupplyRequest = { kind: "building", key: "roboticsFactory", label: "Robotics Factory", level: 6 };
const origin = { ...target, planetId: "1", name: "New Zion", position: 1, resources: { metal: "1133873", crystal: "855054", deuterium: "54388" }, ships: [{ id: 4, count: 20 }], technologyLevels: { 3: 8, 9: 6, 10: 7 } };
const source = batchSupplySourceForPlanet(origin, origin);
let stock = { metal: "500", crystal: "500", deuterium: "0" };
const snapshot = (account = wallet, id = target.planetId) => ({ wallet: account, planetId: id, homePlanetId: "1", resources: { ...stock }, buildings: [{ id: buildingContractIds.roboticsFactory, level: 5, cost: { metal: "12800", crystal: "3840", deuterium: "6400" } }], queue: null });
let deferred = false, holdSend = false;
const reads: Array<{kind: string; account: string; id: string; resolve: () => void}> = [];
const calls: unknown[] = [], sent: unknown[] = [], errors: string[] = [];
let runs = 0, completed = 0, releaseSend: (() => void) | undefined;
const queries = Object.fromEntries(["infrastructure", "supplySources"].map(kind => [kind, (account: string, id: string, options: unknown) => ({ read: () => {
  calls.push({kind, account, id, options});
  const value = kind === "infrastructure" ? snapshot(account, id) : { sources: [origin], fleetSlots: { limit: 9, active: 0 } };
  return deferred ? new Promise(resolve => reads.push({kind, account, id, resolve: () => resolve(value)})) : Promise.resolve(value);
} })])) as unknown as BackendDataStore["queries"];
const provider = { request: async <T,>(call: {method: string; params?: unknown[]}): Promise<T> => {
  if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
  if (call.method === "eth_call") return "0x" as T;
  if (call.method === "eth_estimateGas") return "0xf4240" as T;
  if (call.method !== "eth_sendTransaction") throw new Error(call.method);
  sent.push(call.params); return "0xfixture" as T;
} };
const backendData = { queries };
function Fixture() {
  const [account, setAccount] = useState(wallet);
  const [destination, setDestination] = useState<ManagedPlanetResponse | null>(target);
  const [preview, setPreview] = useState<LevelSupplyPreview | undefined>(() => levelSupplyPreview(request, snapshot() as any, target.planetId));
  const [initialRequested, setInitialRequested] = useState(() => preview!.missing);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const loadId = useRef(0);
  const actions = useBatchSupplyActions({ account, backendData, batchSupplyTarget: destination, batchSupplyTargetIsMoon: false,
    gameContract: "0x2222222222222222222222222222222222222222", provider, signerAccount: account,
    levelSupply: request, levelPreview: preview, batchSupplySourceLoadIdRef: loadId,
    setLevelSupplyLoading: setLoading, setLevelPreview: setPreview, setBatchSupplyError: setError,
    setBatchSupplyInitialRequested: setInitialRequested, setBatchSupplySubmitting: setSubmitting, setBatchSupplyTarget: setDestination,
    runGalaxyTransaction: async (_label, send, options) => {
      runs++;
      try {
        await options.prepare();
        if (holdSend) await new Promise<void>(resolve => { releaseSend = resolve; });
        await send(provider);
        return { outcome: "submitted" } as any;
      } catch (error) { errors.push(String(error)); throw error; }
      finally { completed++; }
    },
  });
  (window as any).confirmationFixture = {
    state: () => ({ runs, completed, calls, sent, errors, loading, submitting, preview, initialRequested, target: destination?.planetId, account, reads: reads.map(({kind, account, id}) => ({kind, account, id})), sendWaiting: Boolean(releaseSend) }),
    spend: (metal = "0") => { stock = { ...stock, metal }; },
    defer: () => { deferred = true; },
    resolve: (index = 0) => { reads.splice(index, 1)[0]!.resolve(); },
    refresh: () => actions.refreshLevelSupply(request, destination!),
    holdSend: () => { holdSend = true; },
    releaseSend: () => { releaseSend!(); releaseSend = undefined; },
    switch: (kind: string) => {
      loadId.current++;
      setSubmitting(false); setLoading(false); setError(undefined);
      if (kind === "account") setAccount("0x3333333333333333333333333333333333333333");
      else setDestination({ ...target, planetId: "832", name: "Other destination" });
    },
    unmount: () => render(null, document.getElementById("app")!),
  };
  return destination ? <BatchSupplyModal key={account + destination.planetId} target={destination} sources={[source]} maxSources={9}
    upgrade={request} preview={preview} initialRequested={initialRequested} loading={loading} actionPending={submitting} error={error}
    onClose={() => { loadId.current++; setDestination(null); }} onRefresh={() => void actions.refreshLevelSupply(request, destination)}
    onConfirm={actions.handleConfirmBatchSupply} /> : <p>Shipment submitted</p>;
}
render(<Fixture />, document.getElementById("app")!);
