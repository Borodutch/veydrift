// Mount the production action hook and modal. External reads and wallet/RPC
// transports are fixtures; optional real coordinator coverage never uses a wallet.
import { render } from "preact";
import { toFunctionSelector } from "viem";
import { useRef, useState } from "preact/hooks";
import { BatchSupplyModal } from "../../src/components/BatchSupplyModal";
import { useBatchSupplyActions, batchSupplySourcesFromSnapshot } from "../../src/PlayableMvpApp";
import { buildBatchSupplyPlan, type SupplyResources } from "../../src/batchSupplyPlanner";
import { levelSupplyPreview, type LevelSupplyPreview, type LevelSupplyRequest } from "../../src/levelSupply";
import { buildingContractIds } from "../../src/playableMvp";
import { configureWalletTransactionTransport, transactionWalletProvider, defaultVeydriftChainForLocation, type ManagedPlanetResponse, type SupplySourcesResponse, type Eip1193Provider } from "../../src/walletFlow";
import { BackendDataStore } from "../../src/backendDataStore";
import type { WriteTransactionState } from "../../src/transactionActionGate";
import "../../src/styles.css";
const wallet = "0x1111111111111111111111111111111111111111";
const contract = "0x2222222222222222222222222222222222222222";
const target = { planetId: "831", name: "New Denver", coordinates: "6:9:12", galaxy: 6, system: 9, position: 12 } as ManagedPlanetResponse;
const goal: LevelSupplyRequest = { kind: "building", key: "roboticsFactory", label: "Robotics Factory", level: 6 };
const cost = { metal: "12800", crystal: "3840", deuterium: "6400" };
let destination = { metal: "500", crystal: "500", deuterium: "0" };
const origin = { ...target, planetId: "1", name: "New Zion", position: 1, coordinates: "6:9:1", resources: { metal: "1133873", crystal: "855054", deuterium: "54388" }, ships: [{ id: 4, count: 20 }], technologyLevels: { 3: 8, 9: 6, 10: 7 } };
const supply = { sources: [origin, { ...origin, planetId: "2", name: "Astro", position: 13, resources: { metal: "0", crystal: "0", deuterium: "20" }, ships: [{ id: 4, count: 1 }] }], fleetSlots: { limit: 9, active: 0 } } as unknown as SupplySourcesResponse;
function snapshot(account: string, planetId: string, resources = destination) {
  return { wallet: account, planetId, homePlanetId: "1", resources, buildings: [{ id: buildingContractIds.roboticsFactory, level: 5, cost }], queue: null } as any;
}
let deferred = false;
const reads: Array<{kind: string; account: string; planetId: string; resolve?: (value: any) => void}> = [];
const sent: any[] = [];
const failures: string[] = [];
const rpcCalls: string[] = [], walletCalls: string[] = [], recovered: string[] = [];
const outcomes: string[] = [];
let coordinated = false, rpcConfigured = false, foregroundTimeout = 10_000;
let store: BackendDataStore | undefined;
let heldStage: string | undefined, releaseStage: (() => void) | undefined;
let gasRead = false;
let moonVersion: string = "0x" + "0".repeat(63) + "1", revertMoon = false;
async function pause(stage: string) {
  if (heldStage === stage) await new Promise<void>(resolve => { releaseStage = resolve; });
}
async function simulationCall(method: string, params?: readonly unknown[]) {
  if (method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex;
  if (method === "eth_call") {
    if ((params?.[0] as {data?: string})?.data === toFunctionSelector("moonSupplyBatchVersion()")) return moonVersion;
    await pause("simulation");
    if (revertMoon) throw new Error("execution reverted");
    return "0x";
  }
  if (method === "eth_estimateGas") { await pause("gas"); gasRead = true; return "0xf4240"; }
  throw new Error(method);
}
const fixtureRpc = "https://supply-rpc.fixture.invalid";
const originalFetch = window.fetch.bind(window);
window.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input) !== fixtureRpc) return originalFetch(input, init);
  const call = JSON.parse(String(init?.body));
  rpcCalls.push(call.method);
  return Response.json({ jsonrpc: "2.0", id: call.id, result: await simulationCall(call.method, call.params) });
}, originalFetch);
let runs = 0, holdSend = false, releaseSend: (() => void) | undefined;
const queries = Object.fromEntries(["supplySources", "infrastructure", "moon", "shipyard"].map(kind => [kind, (account: string, planetId: string) => ({read: () => {
  const row: typeof reads[number] = {kind, account, planetId}; reads.push(row);
  const value = kind === "supplySources" ? structuredClone(supply) : kind === "shipyard" ? structuredClone(origin) : snapshot(account, planetId);
  if (!deferred) return Promise.resolve(value);
  return new Promise(resolve => { row.resolve = override => resolve(override ?? value); });
}})])) as unknown as BackendDataStore["queries"];
const provider: Eip1193Provider = { request: async <T,>(call: {method: string; params?: readonly unknown[]}) => {
  walletCalls.push(call.method);
  if (call.method === "eth_chainId") {
    if (gasRead) await pause("chain");
    return defaultVeydriftChainForLocation().chainIdHex as T;
  }
  if (call.method !== "eth_sendTransaction") {
    if (rpcConfigured) throw new Error("Configured simulation must use app RPC");
    return await simulationCall(call.method, call.params) as T;
  }
  sent.push(structuredClone(call.params));
  await pause("send");
  return "0xfixture" as T;
}};
function Fixture() {
  const generation = useRef(1);
  const [account, setAccount] = useState(wallet);
  const [currentTarget, setTarget] = useState<ManagedPlanetResponse | null>(target);
  const [moon, setMoon] = useState(false);
  const [preview, setPreview] = useState<LevelSupplyPreview | undefined>(() => levelSupplyPreview(goal, snapshot(wallet, "831"), "831"));
  const [requested, setRequested] = useState<SupplyResources>(() => preview!.missing);
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [sources, setSources] = useState(() => batchSupplySourcesFromSnapshot(supply, target));
  const actions = useBatchSupplyActions({ account, backendData: { queries }, batchSupplyTarget: currentTarget,
    batchSupplyTargetIsMoon: moon, gameContract: contract, provider, signerAccount: account,
    levelSupply: moon ? undefined : goal, levelPreview: preview, batchSupplySourceLoadIdRef: generation,
    setLevelSupplyLoading: setLoading, setLevelPreview: setPreview, setBatchSupplyError: setError,
    setBatchSupplyInitialRequested: setRequested, setBatchSupplySubmitting: setPending, setBatchSupplyTarget: setTarget,
    runGalaxyTransaction: async (_label, send, options) => {
      runs++;
      if (coordinated) {
        store ??= new BackendDataStore("https://supply-coordinator.fixture.invalid", {
          transactionForegroundTimeoutMs: foregroundTimeout,
          transactionPollIntervalMs: 0,
          transactionStatusReader: async hash => {
            recovered.push(hash);
            return { events: [], indexedEventCount: 0, latestIndexedBlock: "20", phase: "applied", receiptBlock: "20", transactionHash: hash };
          },
        });
        const outcome = await store.runWriteTransaction({
          key: "galaxy:supply", label: _label, chainId: defaultVeydriftChainForLocation().chainIdHex,
          planetIds: options.affectedPlanetIds,
          invalidateTags: [`wallet:${account.toLowerCase()}`],
          prepare: options.prepare, onErrorRefresh: options.onErrorRefresh,
          waitForIndexing: false,
          send: beforeWalletSend => send(transactionWalletProvider(provider, beforeWalletSend)),
        });
        outcomes.push(outcome.outcome);
        if (outcome.error) failures.push(String(outcome.error));
        return outcome;
      }
      try { await options.prepare(); if (holdSend) await new Promise<void>(resolve => { releaseSend = resolve; });
        const txHash = await send(provider); return {outcome: "submitted", txHash};
      } catch (error) { failures.push(String(error)); await options.onErrorRefresh(); throw error; }
    },
  });
  const originalOrders = useRef(buildBatchSupplyPlan({ sources, requested: {metal:12300,crystal:3340,deuterium:6400}, selectedPlanetIds: new Set(["1"]), targetCoordinates: target }).orders);
  (window as any).actionsFixture = {
    coordinate: (timeout = 10_000, appRpc = false) => {
      coordinated = true; foregroundTimeout = timeout;
      if (appRpc) { rpcConfigured = true; configureWalletTransactionTransport(provider, "injected", fixtureRpc); }
    },
    holdStage: (stage: string) => { heldStage = stage; },
    releaseStage: () => { heldStage = undefined; const finish = releaseStage; releaseStage = undefined; finish?.(); },
    status: () => ({stagePending: Boolean(releaseStage), rpcCalls, walletCalls, outcomes, recovered,
      transaction: store?.snapshot<WriteTransactionState>(store.writeTransactionKey("galaxy:supply", wallet, "1"))?.data,
      reads: reads.map(({kind, account, planetId, resolve}) => ({kind, account, planetId, waiting: Boolean(resolve)})), sent, failures, runs, preview, requested, pending, loading, target: currentTarget?.planetId, error, readyToSend: Boolean(releaseSend)}),
    defer: (value = true) => { deferred = value; },
    spend: () => { destination = {metal:"0",crystal:"0",deuterium:"0"}; },
    resolve: (index: number, metal?: string) => { const row=reads[index]!; const finish=row.resolve!; delete row.resolve; finish(metal === undefined ? undefined : snapshot(row.account,row.planetId,{metal,crystal:"500",deuterium:"0"})); },
    refresh: () => { void actions.refreshLevelSupply(goal, currentTarget!); },
    retryOriginal: () => actions.handleConfirmBatchSupply(originalOrders.current, {}, "transport", {}),
    holdSend: () => { holdSend = true; }, releaseSend: () => { holdSend=false; releaseSend?.(); releaseSend=undefined; },
    multiMoon: (count = 2) => {
      generation.current++; setMoon(true); setPreview(undefined); setRequested({metal:count * 1000,crystal:0,deuterium:0});
      supply.sources = Array.from({length:count}, (_, i) => ({ ...origin, planetId:String(i+1), resources:{metal:"1000",crystal:"0",deuterium:"54388"} }));
      supply.fleetSlots = {limit:15,active:0};
      setSources(batchSupplySourcesFromSnapshot(supply,target));
    },
    capability: (supported: boolean) => { moonVersion = supported ? "0x" + "0".repeat(63) + "1" : "0x"; },
    revert: () => { revertMoon = true; },
    change: (kind: string) => { generation.current++; setPending(false); setLoading(false);
      if(kind === "close") setTarget(null);
      if(kind === "reopen") setTarget({...target});
      if(kind === "account") setAccount("0x3333333333333333333333333333333333333333");
      if(kind === "body") setMoon(value => !value);
      if(kind === "target") setTarget({...target,planetId:"832"});
    },
    stock: (kind: string) => setSources(current => current.map(source => kind === "unselected" && source.planetId === "2" ? {...source,ships:{...source.ships,lightFighter:1}} : kind === "irrelevant" && source.planetId === "1" ? {...source,resources:{...source.resources,metal:source.resources.metal-1},ships:{...source.ships,lightFighter:1}} : kind === "lock" && source.planetId === "1" ? {...source,unavailableReason:"Stale inventory horizon"} : kind === "drive" && source.planetId === "1" ? {...source,driveLevels:{...source.driveLevels,combustionDrive:2}} : kind === "fleet" && source.planetId === "1" ? {...source,ships:{largeCargo:0}} : kind === "fuel" && source.planetId === "1" ? {...source,resources:{...source.resources,deuterium:6400}} : source)),
    unmount: () => render(null,document.getElementById("app")!),
  };
  return currentTarget ? <BatchSupplyModal moonBatchSupported key={account+":"+currentTarget.planetId+":"+generation.current} target={currentTarget}
    targetIsMoon={moon} sources={sources} maxSources={15} initialRequested={requested} upgrade={moon ? undefined : goal} preview={preview}
    loading={loading} actionPending={pending} error={error} onRefresh={() => void actions.refreshLevelSupply(goal,currentTarget)}
    onClose={() => {generation.current++;setTarget(null);}} onConfirm={actions.handleConfirmBatchSupply} /> : <p>Closed</p>;
}
render(<Fixture />, document.getElementById("app")!);
