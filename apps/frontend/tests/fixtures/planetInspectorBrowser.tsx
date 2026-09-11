import { h, render, options, type VNode } from "preact";
import { BackendDataStore, backendDataStoreFor } from "../../src/backendDataStore";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { useBackendDataSnapshots } from "../../src/useBackendDataSnapshot";
import { apiBaseUrlForRuntimeConfig } from "../../src/runtimeConfig";
import { FirstPlanetSettlementApp } from "../../src/FirstPlanetSettlementApp";
import { PlayableMvpApp } from "../../src/PlayableMvpApp";
import { UiClock } from "../../src/useUiClock";
import { PlanetDetail } from "../../src/components/PlanetDetail";
import { PublicMoonDetail } from "../../src/components/PublicMoonDetail";
import { initSfx } from "../../src/sfx";
import { TopBar } from "../../src/components/TopBar";
import type { Coordinates } from "../../src/types";
import type { Eip1193Provider, ManagedPlanetResponse } from "../../src/walletFlow";
import "../../src/styles.css";

declare global {
  interface Window {
    inspectorProof: {
      account: string;
      appReady: boolean;
      errors: string[];
      interactions: Array<{ isTrusted: boolean; pointerType?: string; target: string; type: string }>;
      requests: string[];
      walletRequests: Array<{ method: string; params?: unknown[] }>;
      beginDetailRace(kind: "moon" | "planet"): void;
      pendingDetailRequests(): string[];
      resolveDetailRequest(key: string): void;
      renderResourceBar(scope: string, metal: number): void;
      rootRenderMs: number[];
      clockRenders: number;
      refreshMissionQueries(): Promise<unknown>;
    };
  }
}

const account = "0x1111111111111111111111111111111111111111";
const unrelatedOwner = "0x9999999999999999999999999999999999999999";
const appRoot = document.querySelector("#app") as HTMLElement;
const fixtureParams = new URLSearchParams(window.location.search);
// Only the isolated memo probe needs this module up front. Eagerly importing it
// in every fixture bypasses the real app's lazy-route failure path.
const MissionControlPage = fixtureParams.get("missionMemoProbe") === "true"
  ? (await import("../../src/components/MissionControlPage")).MissionControlPage
  : () => null;
const route = fixtureParams.get("route") ?? "/planet/9/9/9";
const settlementShell = fixtureParams.get("shell") === "settlement";
const incompleteOverview = fixtureParams.get("incompleteOverview") === "true";
const stallMissionBackgroundReads = fixtureParams.get("stallMissionBackgroundReads") === "true";
const walletEventOnPointerDown = fixtureParams.get("walletEventOnPointerDown");
const audioContextFailure = fixtureParams.get("audioContextFailure") === "true";
const shortResources = fixtureParams.get("shortResources") === "true";
const publicTreasury = fixtureParams.get("publicTreasury") === "true";
const moonOverview = fixtureParams.get("moonOverview") === "true";
const selectedPlanetResources = shortResources
  ? { crystal: "5", deuterium: "2", metal: "10" }
  : { crystal: "3873", deuterium: "102", metal: "10313" };

const ownedPlanets = [
  managedPlanet({
    galaxy: 1,
    isHomePlanet: true,
    name: "Owned Alpha",
    moon: moonOverview || fixtureParams.get("activeMission") === "true" ? { exists: true } : null,
    planetId: "101",
    position: 3,
    resources: selectedPlanetResources,
    system: 2,
  }),
  managedPlanet({
    galaxy: 4,
    isHomePlanet: false,
    name: "Owned Beta",
    planetId: "102",
    position: 6,
    resources: { crystal: "201", deuterium: "202", metal: "203" },
    system: 5,
  }),
];

const publicSystems = new Map([
  ["1:2", systemPayload(1, 2, 3, "Owned Alpha Public", account, "101", 1101, true)],
  ["4:5", systemPayload(4, 5, 6, "Owned Beta Public", account, "102", 2202, false)],
  ["9:9", systemPayload(9, 9, 9, "Unrelated Gamma", unrelatedOwner, "9909", 9909, true)],
]);
publicSystems.get("1:2")?.planets.push(
  systemPayload(1, 2, 9, "Nearby Rival", unrelatedOwner, "nearby-rival", 4404, true).planets[0]!,
);

const pendingDetailRequests = new Map<string, (response: Response) => void>();
let detailRaceKind: "moon" | "planet" | null = null;
const fixtureErrors: string[] = [];
const fixtureInteractions: Array<{ isTrusted: boolean; pointerType?: string; target: string; type: string }> = [];
const fixtureRequests: string[] = [];
const walletRequests: Array<{ method: string; params?: unknown[] }> = [];
const providerListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const originalConsoleError = console.error;
console.error = (...values) => {
  fixtureErrors.push(values.map(String).join(" "));
  originalConsoleError(...values);
};
window.addEventListener("error", (event) => fixtureErrors.push(`window-error:${event.message}`));
window.addEventListener("unhandledrejection", (event) => fixtureErrors.push(`unhandled:${event.reason?.stack ?? String(event.reason)}`));
for (const type of ["pointerdown", "click"] as const) {
  window.addEventListener(type, (event) => {
    const target = event.target instanceof Element
      ? `${event.target.tagName.toLowerCase()}:${event.target.textContent?.trim() ?? ""}`
      : "unknown";
    fixtureInteractions.push({
      isTrusted: event.isTrusted,
      ...(event instanceof PointerEvent ? { pointerType: event.pointerType } : {}),
      target,
      type,
    });
  }, { capture: true });
}

class FixtureEventSource extends EventTarget {
  close() {}
  onerror: ((event: Event) => void) | null = null;
}

Object.defineProperty(window, "EventSource", { configurable: true, value: FixtureEventSource });
Object.defineProperty(globalThis, "EventSource", { configurable: true, value: FixtureEventSource });
// Route page-exit presence through the fetch mock too, never a real dev/prod proxy.
Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: () => false });

const provider: Eip1193Provider = {
  on(event, listener) {
    const listeners = providerListeners.get(event) ?? new Set();
    listeners.add(listener);
    providerListeners.set(event, listeners);
  },
  removeListener(event, listener) {
    providerListeners.get(event)?.delete(listener);
  },
  request: async ({ method, params }) => {
    walletRequests.push({ method, ...(params ? { params } : {}) });
    if (method === "eth_chainId") return settlementShell ? "0x2105" : "0x14a34";
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
    if (method === "eth_sendTransaction") {
      // Keep the request pending like an open wallet confirmation. Browser tests
      // can prove the Build click reached the wallet without confirming/broadcasting.
      return new Promise<string>(() => undefined);
    }
    return null;
  },
};

globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input), window.location.origin);
  fixtureRequests.push(`${url.pathname}${url.search}`);
  const systemMatch = url.pathname.match(/\/universe\/galaxies\/(\d+)\/systems\/(\d+)/);

  if (url.origin !== window.location.origin) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { id?: unknown; method?: unknown };
    if (body.method === "eth_chainId") {
      return Response.json({ id: body.id, jsonrpc: "2.0", result: settlementShell ? "0x2105" : "0x14a34" });
    }
    if (body.method === "eth_call") return Response.json({ id: body.id, jsonrpc: "2.0", result: "0x" });
    return Response.json({
      error: { code: -32601, message: `Fixture JSON-RPC method not implemented: ${String(body.method)}` },
      id: body.id,
      jsonrpc: "2.0",
    });
  }

  if (stallMissionBackgroundReads && (
    url.pathname.endsWith(`/wallet/${account}/missions`)
    || url.pathname.endsWith(`/wallet/${account}/missile-attacks`)
    || (url.pathname.endsWith("/missions") && url.searchParams.get("status") === "completed")
  )) {
    return new Promise<Response>(() => undefined);
  }

  if (detailRaceKind && systemMatch) {
    const key = `${systemMatch[1]}:${systemMatch[2]}`;
    return new Promise<Response>((resolve) => pendingDetailRequests.set(key, resolve));
  }

  if (url.pathname.endsWith("/runtime-config")) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return Response.json({
      allianceContractAddress: publicTreasury ? "0x3333333333333333333333333333333333333333" : null,
      ...(publicTreasury ? {
        paidAllianceInviteAddress: "0x4444444444444444444444444444444444444444",
        paidAllianceInviteSignerAddress: null,
        paidAllianceInviteCapabilities: { redemption: false, recovery: false },
      } : {}),
      apiUrl: `${window.location.origin}/api`,
      chainId: settlementShell ? 8453 : 84532,
      contractAddress: "0x2222222222222222222222222222222222222222",
      featureSupport: {
        allianceConfigured: publicTreasury,
        gameConfigured: true,
        highscoresEndpoint: true,
        moonConfigured: false,
        referralsConfigured: false,
        researchEndpoint: true,
        resourceTokensConfigured: false,
        settlementConfigured: true,
      },
      gameContractAddress: "0x2222222222222222222222222222222222222222",
      graphqlUrl: `${window.location.origin}/graphql`,
      moonContractAddress: null,
      network: settlementShell ? "base" : "base-sepolia",
      resourceTokenAddresses: { crystal: null, deuterium: null, metal: null },
      rpcProvider: "unknown",
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/overview`)) {
    return Response.json(incompleteOverview ? incompleteWalletOverview() : walletOverview());
  }

  if (url.pathname.endsWith(`/wallet/${account}/settlement`)) {
    return Response.json(walletOverview().settlement);
  }

  if (url.pathname.endsWith(`/wallet/${account}/planets`)) {
    return Response.json(walletOverview().planetsResponse);
  }
  if (url.pathname.endsWith(`/wallet/${account}/queues`)) {
    return Response.json(walletOverview().queues);
  }
  if (url.pathname.endsWith(`/wallet/${account}/fleet-visibility`)) {
    return Response.json(walletOverview().fleetVisibility);
  }
  if (url.pathname.endsWith("/missions") && url.searchParams.get("status") === "active") {
    if (url.searchParams.get("summaryOnly") === "true") return Response.json({ totalEntries: Number(fixtureParams.get("activeMissionCount") ?? (fixtureParams.get("activeMission") === "true" ? 1 : 0)) });
    return Response.json({ missions: Array.from({ length: Number(fixtureParams.get("activeMissionCount") ?? (fixtureParams.get("activeMission") === "true" ? 1 : 0)) }, (_, index) => ({
      missionId: String(777 + index),
      status: "Outbound",
      missionType: "Transport",
      owner: unrelatedOwner,
      originPlanetId: "101",
      targetPlanetId: "102",
      arrivalAt: String(Math.floor(Date.now() / 1000) + 3600),
      returnAt: String(Math.floor(Date.now() / 1000) + 7200),
      fuelCost: "0",
      recallCost: null,
      attackGroupId: null,
      joinedAttackMissionIds: [],
      cargo: { metal: "10", crystal: "0", deuterium: "0" },
      ships: {},
      transactionHash: "0xfixture",
      blockNumber: "1",
    })) });
  }

  if (url.pathname.endsWith(`/wallet/${account}/missions`)) {
    return Response.json({
      homePlanetId: ownedPlanets[0]!.planetId,
      pagination: emptyArchivePagination(url),
      rows: [],
      wallet: account,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/missile-attacks`)) {
    return Response.json({
      homePlanetId: ownedPlanets[0]!.planetId,
      pagination: emptyArchivePagination(url),
      rows: [],
      wallet: account,
    });
  }

  if (url.pathname.endsWith("/missions") && url.searchParams.get("status") === "completed") {
    return Response.json({
      pagination: emptyArchivePagination(url),
      rows: [],
    });
  }

  if (url.pathname.endsWith(`/wallet/${unrelatedOwner}/planets`)) {
    return Response.json({ wallet: unrelatedOwner, homePlanetId: null, planets: [] });
  }
  if (url.pathname.endsWith(`/wallet/${unrelatedOwner}/highscore`)) {
    return Response.json({ entry: {
      wallet: unrelatedOwner, homePlanetId: null, planetCount: 0, rank: 3,
      displayName: "Public Commander", profile: { wallet: unrelatedOwner, displayName: "Public Commander", description: "Public biography" },
      score: { total: "100", economy: "100", research: "0", researchLevels: "0", military: "0", fleet: "0", fleetCount: "0", defense: "0" },
      alliance: null
    } });
  }
  if (url.pathname.endsWith("/alliance/8")) {
    return Response.json({ alliance: {
      allianceId: "8", active: true, createdAt: "1770000000", description: "Public roster fixture",
      memberCount: 1, name: "Other Fleet", owner: unrelatedOwner, tag: "OTHER",
      members: [{ address: unrelatedOwner, displayName: "Public Admiral", role: "owner", joinedAt: "1770000000", totalScore: "100" }]
    } });
  }
  if (url.pathname.endsWith(`/wallet/${account}/profile`)) {
    return Response.json({
      description: null,
      displayName: "Fixture Commander",
      fallbackName: "Fixture Commander",
      updatedAt: null,
      wallet: account,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/alliance`)) {
    return Response.json({
      activeWars: [],
      allianceAvailable: true,
      allianceJoinRequests: [],
      diplomacy: [],
      directory: [{
        active: true,
        allianceId: "7",
        createdAt: "1770000000",
        description: "Fixture alliance for hydrated route coverage.",
        memberCount: 1,
        members: [],
        name: "Fixture Fleet",
        owner: unrelatedOwner,
        ownerDisplayName: "Fixture Admiral",
        tag: "FIX",
        totalMemberScore: "12345",
      }],
      members: [],
      membership: publicTreasury
        ? { allianceId: "7", joinedAt: "1770000000", role: "owner" }
        : { allianceId: "0", joinedAt: "0", role: "none" },
      pendingInvites: [],
      pendingJoinRequests: [],
      profile: publicTreasury ? {
        active: true, createdAt: "1770000000", description: "Public treasury fixture",
        memberCount: 1, name: "Fixture Fleet", owner: account, tag: "FIX",
        bonusBalance: { metal: "39409", crystal: "20657", deuterium: "7056" },
        privateInviteStats: { remaining: 0, used: 8 },
      } : null,
      wallet: account,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/supply-sources`)) {
    return Response.json({
      wallet: account,
      fleetSlots: { active: 0, limit: 1 },
      fleetLaunchAvailable: true,
      technologyLevels: { "3": 6, "6": 2 },
      sources: ownedPlanets.filter(planet => planet.planetId !== url.searchParams.get("planetId")).map(planet => ({
        planetId: planet.planetId, name: planet.name, coordinates: planet.coordinates,
        galaxy: planet.galaxy, system: planet.system, position: planet.position,
        resources: { metal: "10000", crystal: "10000", deuterium: "10000" },
        launchableShips: [{ id: 0, count: 5 }],
      })),
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/shipyard`)) {
    return Response.json({
      wallet: account,
      homePlanetId: "1",
      planetId: "1",
      productionAvailable: true,
      resources: shortResources ? selectedPlanetResources : { crystal: "3873", deuterium: "0", metal: "10313" },
      resourcesAsOfNow: shortResources ? selectedPlanetResources : { crystal: "3873", deuterium: "0", metal: "10313" },
      fleetSlots: { active: 0, limit: 1 },
      shipyardLevel: 5,
      naniteLevel: 0,
      technologyLevels: { "3": 6, "6": 2 },
      ships: [{
        id: 0,
        count: 5,
        cost: { crystal: "2000", deuterium: "0", metal: "2000" },
        durationSeconds: 60,
      }],
      queue: null,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/infrastructure`)) {
    const planet = ownedPlanets.find((planet) => planet.planetId === url.searchParams.get("planetId")) ?? ownedPlanets[0]!;
    return Response.json({
      buildings: [
        { id: 0, level: 4, cost: { crystal: "30", deuterium: "0", metal: "120" }, durationSeconds: 60 },
        { id: 3, level: 5, cost: { crystal: "60", deuterium: "0", metal: "150" }, durationSeconds: 90 },
        ...(publicTreasury ? [{ id: 15, level: 1, cost: { crystal: "0", deuterium: "0", metal: "0" }, durationSeconds: 60 }] : []),
      ],
      energyBalance: { available: "20", consumed: "80", produced: "100" },
      homePlanetId: "101",
      infrastructureAvailable: true,
      planetId: planet.planetId,
      productionPerHour: { crystal: "238", deuterium: "71", metal: "620" },
      queue: null,
      resources: planet.resources,
      resourcesAsOfNow: planet.resources,
      storageCaps: { crystal: "10000", deuterium: "10000", metal: "10000" },
      wallet: account,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/moon`)) {
    return Response.json({
      buildings: [],
      defenseQueue: null,
      defenses: [],
      homePlanetId: "101",
      moon: moonOverview ? { exists: true, planetId: "101" } : null,
      ...(moonOverview ? {
        resources: { metal: "1234", crystal: "567", deuterium: "890" },
        launchableShips: [{ id: 0, count: 3, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
      } : {}),
      queue: null,
      wallet: account,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/defenses`)) {
    return Response.json({
      defenses: [{
        cost: { crystal: "0", deuterium: "0", metal: "2000" },
        count: 3,
        durationSeconds: 60,
        id: 0,
      }],
      homePlanetId: "101",
      missileSiloLevel: 0,
      naniteLevel: 0,
      productionAvailable: true,
      queue: null,
      resources: { crystal: "3873", deuterium: "102", metal: "10313" },
      resourcesAsOfNow: { crystal: "3873", deuterium: "102", metal: "10313" },
      shipyardLevel: 5,
      technologyLevels: { "3": 6, "6": 2 },
      wallet: account,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/research`)) {
    return Response.json({
      homePlanetId: "101",
      planetId: "101",
      queue: null,
      researchAvailable: true,
      researchLabLevel: 1,
      researchNetworkLabLevels: [],
      resources: { crystal: "3873", deuterium: "102", metal: "10313" },
      resourcesAsOfNow: { crystal: "3873", deuterium: "102", metal: "10313" },
      technologies: [{
        cost: { crystal: "400", deuterium: "200", metal: "800" },
        durationSeconds: 60,
        id: 0,
        level: 1,
      }],
      technologyLevels: { "0": 1 },
      wallet: account,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/watched-planets`)) {
    return Response.json({
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
      planets: [],
      wallet: account,
      watchedPlanetIds: [],
    });
  }

  if (systemMatch) {
    const key = `${systemMatch[1]}:${systemMatch[2]}`;
    return Response.json(publicSystems.get(key) ?? { galaxy: Number(systemMatch[1]), system: Number(systemMatch[2]), planets: [] });
  }

  if (url.pathname.includes("/attack-protection")) {
    return Response.json({ blockedReason: "none", isProtected: false, isSameAlliance: false });
  }

  return Response.json({ error: `Fixture endpoint not implemented: ${url.pathname}` }, { status: 404 });
}) as typeof fetch;

document.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof HTMLButtonElement ? event.target : undefined;
  if (walletEventOnPointerDown === "accountsChanged" && target?.textContent?.trim() === "Build") {
    for (const listener of providerListeners.get("accountsChanged") ?? []) listener([account]);
  }
  if (walletEventOnPointerDown === "chainChanged" && target?.textContent?.trim() === "Build") {
    for (const listener of providerListeners.get("chainChanged") ?? []) listener("0x2105");
  }
}, { capture: true });

window.inspectorProof = {
  account,
  appReady: false,
  rootRenderMs: [],
  clockRenders: 0,
  refreshMissionQueries: () => backendDataStoreFor(apiBaseUrlForRuntimeConfig({ apiUrl: `${window.location.origin}/api` })).invalidate(["kind:global-active-missions", "kind:global-active-mission-count"]),
  renderResourceBar(scope, metal) {
    render(<TopBar resourceScope={scope} resources={{ metal, crystal: 222, deuterium: 333 }} rates={{ metal: 10, crystal: 20, deuterium: 30 }} caps={{ metal: 10000, crystal: 10000, deuterium: 10000 }} isWalletConnected resourceStatus="ready" />, appRoot);
  },
  errors: fixtureErrors,
  interactions: fixtureInteractions,
  requests: fixtureRequests,
  walletRequests,
  beginDetailRace(kind) {
    detailRaceKind = kind;
    pendingDetailRequests.clear();
    const oldCoords = { galaxy: 7, system: 1, position: 2 };
    renderDetail(kind, oldCoords);
    queueMicrotask(() => renderDetail(kind, { galaxy: 8, system: 2, position: 4 }));
  },
  pendingDetailRequests() {
    return [...pendingDetailRequests.keys()].sort();
  },
  resolveDetailRequest(key) {
    const resolve = pendingDetailRequests.get(key);
    if (!resolve) throw new Error(`No pending detail request for ${key}`);
    const [galaxy, system] = key.split(":").map(Number);
    const isOld = galaxy === 7;
    resolve(Response.json(systemPayload(
      galaxy,
      system,
      isOld ? 2 : 4,
      `${isOld ? "Stale" : "Current"} ${detailRaceKind === "moon" ? "Moon Parent" : "Planet"}`,
      isOld ? unrelatedOwner : account,
      isOld ? "stale" : "current",
      isOld ? 7001 : 8002,
      detailRaceKind === "moon",
    )));
    pendingDetailRequests.delete(key);
  },
};

// Opt-in profiling in the isolated test page; never installed in the game bundle.
if (fixtureParams.get("profileRoot") === "true") {
  const hooks = options as typeof options & { __r?: (vnode: VNode) => void };
  const beforeRender = hooks.__r;
  const afterDiff = hooks.diffed;
  const starts = new WeakMap<VNode, number>();
  hooks.__r = vnode => {
    beforeRender?.(vnode);
    if (vnode.type === PlayableMvpApp) starts.set(vnode, performance.now());
    if (vnode.type === UiClock) window.inspectorProof.clockRenders++;
  };
  hooks.diffed = vnode => {
    afterDiff?.(vnode);
    const start = starts.get(vnode);
    if (start !== undefined) window.inspectorProof.rootRenderMs.push(performance.now() - start);
  };
}

history.replaceState({ fixture: true }, "", route);
if (audioContextFailure) {
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: class {
      constructor() {
        throw new Error("simulated AudioContext startup failure");
      }
    },
  });
}
if (fixtureParams.get("missionMemoProbe") === "true") {
  render(<MissionMemoProbe />, appRoot);
} else if (fixtureParams.get("snapshotProbe") === "true") {
  render(<SnapshotProbe />, appRoot);
} else if (settlementShell) {
  Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
  render(<FirstPlanetSettlementApp />, appRoot);
} else {
  render(<PlayableMvpApp account={account} provider={provider} />, appRoot);
}
initSfx();
window.inspectorProof.appReady = true;

function MissionMemoProbe() {
  const [tick, setTick] = useState(0);
  const [version, setVersion] = useState(0);
  const reads = useRef(0);
  const fleetVisibility = useMemo(() => ({
    wallet: account, homePlanetId: "7", allianceId: null, incoming: [], returning: [],
    joinableAttacks: [], joinableDefenses: [], completedMissions: [], battleReports: [],
    get outgoing() {
      reads.current++;
      return [{ missionId: String(700 + version), status: "Outbound" as const, missionType: "Transport" as const,
        owner: account, originPlanetId: "7", targetPlanetId: "8", arrivalAt: "1770003600", returnAt: "1770007200",
        fuelCost: "0", recallCost: null, attackGroupId: null, joinedAttackMissionIds: [],
        cargo: { metal: "10", crystal: "0", deuterium: "0" }, ships: {}, transactionHash: "0xfixture", blockNumber: "1" }];
    },
  }), [version]);
  useLayoutEffect(() => {
    document.querySelector<HTMLElement>("[data-mission-memo-probe]")!.dataset.reads = String(reads.current);
  });
  return <div data-mission-memo-probe data-tick={tick} data-version={version}>
    <button data-tick onClick={() => setTick(tick + 1)}>Tick</button>
    <button data-replace onClick={() => setVersion(version + 1)}>Replace feed</button>
    <MissionControlPage actionState={{ status: "idle" }} canTransact={false} fleetVisibility={fleetVisibility}
      loading={false} now={1770000000000 + tick * 1000}
      onCounterplay={() => {}} onJoinAttack={() => {}} onOpenReport={() => {}}
      onOpenReportList={() => {}} onRecall={() => {}} onRefresh={() => {}} />
  </div>;
}

function SnapshotProbe() {
  const store = useMemo(() => new BackendDataStore("https://snapshot-probe.invalid"), []);
  const [selected, select] = useState("a");
  const [tick, setTick] = useState(0);
  const key = store.key("probe", selected);
  const snapshots = useBackendDataSnapshots<string>(store, [key]);
  const previous = useRef(snapshots);
  const changes = useRef(0);
  if (previous.current !== snapshots) changes.current++;
  previous.current = snapshots;
  useLayoutEffect(() => {
    // Complete between render and the passive subscription effect.
    void store.refresh(key, async () => selected);
  }, [key]);
  useLayoutEffect(() => () => store.dispose(), [store]);
  return <div data-snapshot-probe data-changes={changes.current} data-tick={tick}>
    <output>{snapshots.get(key)?.data ?? "pending"}</output>
    <button onClick={() => setTick(tick + 1)}>Rerender</button>
    <button onClick={() => select(selected === "a" ? "b" : "a")}>Switch query</button>
  </div>;
}

function renderDetail(kind: "moon" | "planet", coords: Coordinates) {
  const props = {
    account,
    apiBaseUrl: `${window.location.origin}/api`,
    coords,
    onBack: () => undefined,
  };
  render(kind === "moon" ? <PublicMoonDetail {...props} /> : <PlanetDetail {...props} />, appRoot);
}

function managedPlanet(overrides: Partial<ManagedPlanetResponse>): ManagedPlanetResponse {
  const galaxy = overrides.galaxy ?? 1;
  const system = overrides.system ?? 2;
  const position = overrides.position ?? 3;
  return {
    coordinates: `${galaxy}:${system}:${position}`,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    fields: 200,
    fieldsCapacity: 200,
    fieldsUsed: 7,
    galaxy,
    isHomePlanet: false,
    keyLevels: {
      crystalMine: 2,
      deuteriumSynthesizer: 3,
      metalMine: 1,
      researchLab: 0,
      roboticsFactory: 0,
      shipyard: 0,
      solarPlant: 4,
      terraformer: 0,
    },
    lastSettledAt: "1770000000",
    metalMultiplierBps: 10_000,
    moon: null,
    name: "Owned fixture",
    owner: account,
    planetId: "owned-fixture",
    position,
    queues: { building: null, defense: null, ship: null },
    resources: { crystal: "1", deuterium: "2", metal: "3" },
    system,
    temperature: 20,
    ...overrides,
  };
}

function walletOverview() {
  const selected = ownedPlanets[0]!;
  return {
    fleetVisibility: {
      battleReports: [],
      completedMissions: [],
      homePlanetId: selected.planetId,
      incoming: [],
      joinableAttacks: [],
      outgoing: [],
      returning: [],
      wallet: account,
    },
    planetsResponse: {
      homePlanetId: selected.planetId,
      planets: ownedPlanets,
      queues: { research: null },
      wallet: account,
    },
    queues: {
      building: null,
      defense: null,
      homePlanetId: selected.planetId,
      research: null,
      ship: null,
      wallet: account,
    },
    settlement: {
      hasFirstPlanet: true,
      homePlanetId: selected.planetId,
      planet: selected,
      wallet: account,
    },
  };
}

function incompleteWalletOverview() {
  const overview = walletOverview();
  return {
    ...overview,
    planetsResponse: {
      ...overview.planetsResponse,
      planets: [],
    },
    settlement: {
      ...overview.settlement,
      planet: null,
    },
  };
}

function emptyArchivePagination(url: URL) {
  return {
    hasNextPage: false,
    hasPreviousPage: false,
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
    totalEntries: 0,
    totalPages: 1,
  };
}

function systemPayload(
  galaxy: number,
  system: number,
  position: number,
  name: string,
  owner: string,
  planetId: string,
  metal: number,
  hasMoon: boolean,
) {
  return {
    galaxy,
    planets: [{
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 10_000,
      fields: 200,
      galaxy,
      hasMoon,
      metalMultiplierBps: 10_000,
      name,
      occupiedBy: { owner, ownerDisplayName: `${name} — Long Range Expeditionary Commander`, planetId },
      position,
      publicMoonState: hasMoon ? {
        buildings: [{ id: 0, level: metal === 8002 ? 8 : 7 }],
        defenses: [{ count: metal === 8002 ? 82 : 71, id: 0 }],
        resources: { crystal: String(metal + 1), deuterium: String(metal + 2), metal: String(metal) },
      } : null,
      publicState: {
        buildings: [{ id: 0, level: metal === 8002 ? 8 : 7 }],
        defenses: [{ count: metal === 8002 ? 82 : 71, id: 0 }],
        fleet: [{ count: metal === 8002 ? 42 : 31, id: 0 }],
        resources: { crystal: String(metal + 1), deuterium: String(metal + 2), metal: String(metal) },
      },
      system,
      temperature: 20,
    }],
    system,
  };
}
